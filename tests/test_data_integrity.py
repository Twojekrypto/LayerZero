import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate_flows as flows
import refresh_balances as balances
import sanitize_zro_data as sanitize
from flow_metrics import merge_transfers, period_retention, transfer_identity
from fresh_wallet_utils import derive_fresh_signal
from refresh_market_data import apply_market_data
import utils
import fetch_holders as fetcher

ADDR = "0x" + "1" * 40


class DataIntegrityTests(unittest.TestCase):
    def run_holder_fetch(self, transfers):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"holders.json"
            path.write_text(json.dumps({"holders":[dict(address=ADDR, balances={"ethereum":1000})]}))
            with patch.object(fetcher, "OUTPUT_FILE", str(path)), patch.object(fetcher, "DIR", temp), \
                 patch.object(fetcher, "CHAINS", {"ethereum":dict(chainid=1, short="ETH")}), \
                 patch.object(fetcher, "load_state", return_value={"ethereum":{"last_block":10}}), patch.object(fetcher, "should_full_rescan", return_value=False), \
                 patch.object(fetcher, "ALCHEMY_KEY", ""), patch.object(fetcher, "fetch_transfers_etherscan", return_value=(transfers, 20)), \
                 patch.object(fetcher, "save_state"), patch.object(fetcher, "atomic_json_dump") as save, \
                 patch.object(fetcher.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
                fetcher.main()
            return save.call_args.args[0]

    def test_empty_holder_scan_preserves_snapshot_instead_of_csv(self):
        result = self.run_holder_fetch([])
        self.assertEqual(result["holders"][0]["balances"]["ethereum"], 1000)
        self.assertEqual(result["chain_stats"]["ethereum"]["source"], "preserved_snapshot")

    def test_incremental_scan_does_not_resurrect_zero_balance(self):
        result = self.run_holder_fetch([{"from":ADDR, "to":"0x"+"2"*40, "value":str(1000*10**18)}])
        self.assertNotIn(ADDR, [h["address"] for h in result["holders"]])

    def test_period_retention_excludes_old_balance_and_stays_bounded(self):
        self.assertEqual(period_retention(1000, 900), 0.1)
        self.assertEqual(period_retention(0, 100), 0)
        self.assertEqual(period_retention(100, 200), 0)
        self.assertEqual(period_retention(100, 0), 1)

    def test_normalize_replaces_stale_scores_and_balances(self):
        row = dict(address=ADDR, balance=1000000, net_flow=1000, total_in=2000,
                   total_out=1000, retention_ratio=500, flow_score=9999999)
        holder = dict(label="", type="", balances={"ethereum": 2000})
        normalized, reason = sanitize.normalize_flow_item(row, {ADDR: holder})
        self.assertEqual(reason, "ok")
        self.assertEqual(normalized["balance"], 2000)
        self.assertEqual(normalized["retention_ratio"], 0.5)
        self.assertNotEqual(normalized["flow_score"], row["flow_score"])

    def test_current_cex_classification_overrides_old_flow_label(self):
        row = dict(address=ADDR, type="WHALE", balance=10000, net_flow=1000)
        normalized, reason = sanitize.normalize_flow_item(row, {ADDR: dict(type="CEX", label="Exchange", balances={"ethereum": 10000})})
        self.assertIsNone(normalized)
        self.assertEqual(reason, "infrastructure")

    def test_unresolved_count_excludes_removed_rows(self):
        data = {"top_holders": [dict(address=ADDR, balances={"ethereum": 10000})],
                "flows": {"7d": {"accumulators": [dict(address=ADDR, net_flow=1)], "sellers": []}}}
        summary = sanitize.normalize_flows(data)
        self.assertEqual(data["flows"]["7d"]["accumulators"], [])
        self.assertEqual(summary["7d"]["chain_unresolved_rows"], 0)

    def test_whale_diagnostics_count_only_last_500_rows(self):
        data = {"whale_transfers": [dict(tx_hash=f"0x{i:064x}", **{"from":ADDR, "to":"0x"+"2"*40},
                                           value=100000, timestamp=i) for i in range(501)]}
        summary = sanitize.normalize_whale_transfers(data)
        self.assertEqual(summary["normalized_rows"], 500)
        self.assertEqual(len(data["whale_transfers"]), 500)

    def test_transfers_between_different_exchanges_are_not_withdrawals(self):
        other = "0x" + "2" * 40
        data = {"top_holders":[dict(address=ADDR, type="CEX", label="Exchange A"),
                                dict(address=other, type="CEX", label="Exchange B")],
                "whale_transfers":[dict(tx_hash="0xabc", **{"from":ADDR, "to":other}, value=100000)]}
        result = sanitize.normalize_whale_transfers(data)
        self.assertEqual(data["whale_transfers"], [])
        self.assertEqual(result["removed_cex_to_cex"], 1)

    def test_event_identity_keeps_multiple_logs_and_chains(self):
        row = dict(hash="0xabc", chain="ethereum", log_index="0x1")
        self.assertEqual(transfer_identity(row), transfer_identity({**row, "log_index":1}))
        self.assertNotEqual(transfer_identity(row), transfer_identity({**row, "log_index":2}))
        self.assertNotEqual(transfer_identity(row), transfer_identity({**row, "chain":"arbitrum"}))

    def test_failed_page_is_not_accepted_as_complete_history(self):
        tx = dict(value="1", timeStamp="1", hash="0xabc")
        responses = [{"status":"1", "result":[tx]*1000}, {"status":"0", "result":"Max rate limit reached"}]
        with patch.object(flows, "fetch_json", side_effect=responses), patch.object(flows.time, "sleep"):
            with self.assertRaises(RuntimeError):
                flows.get_zro_transfers(ADDR, "ethereum", 1)

    def test_replacing_legacy_rows_keeps_two_distinct_logs_without_double_counting(self):
        old = dict(hash="0xabc", **{"from":ADDR, "to":"0x2"}, value=100, timestamp=1)
        incoming = [{**old, "chain":"ethereum", "log_index":i} for i in [1, 2]]
        merged, _ = merge_transfers([old], incoming)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merge_transfers(merged, incoming)[1], 0)

    def test_partial_scan_does_not_advance_failed_wallet_cursor(self):
        other = "0x"+"2"*40
        data = {"meta":{}, "top_holders":[dict(address=a, balances={"ethereum":10000}) for a in [ADDR, other]]}
        cache = {"last_blocks":{"ethereum":10}, "transfers":{}, "scan_blocks":{"ethereum":{ADDR:10, other:9}}}
        def fetch(address, *args):
            if address == other:
                raise RuntimeError("rate limit")
            return []
        with patch.object(flows, "API_KEY", "test"), patch.object(flows, "load_cache", return_value=cache), \
             patch.object(flows.json, "load", return_value=data), \
             patch.object(flows, "get_current_block", return_value=20), patch.object(flows, "get_zro_transfers", side_effect=fetch), \
             patch.object(flows, "CHAINS", {"ethereum":dict(id=1, block_time=12, top_n=2)}), \
             patch.object(flows, "save_cache"), patch.object(flows.os.path, "getsize", return_value=0), \
             patch.object(flows, "atomic_json_dump"), patch.object(flows.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            flows.main()
        self.assertEqual(cache["scan_blocks"]["ethereum"], {ADDR:20, other:9})
        self.assertEqual(cache["last_blocks"]["ethereum"], 10)
        self.assertTrue(data["meta"]["flow_coverage"]["partial"])

    def test_all_balance_failures_preserve_timestamp_and_file(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"data.json"
            data = {"meta":{"generated":"old"}, "top_holders":[dict(address=ADDR, balances={"ethereum":10000})]}
            path.write_text(json.dumps(data))
            with patch.object(balances, "API_KEY", "test"), patch.object(balances, "DATA_PATH", path), \
                 patch.object(balances, "get_recent_unlock_transfers", return_value=[]), \
                 patch.object(balances, "get_token_balance", return_value=None), \
                 patch.object(balances.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):
                    balances.main()
            self.assertEqual(json.loads(path.read_text()), data)

    def test_fresh_retention_cannot_be_boosted_by_old_tokens(self):
        signal = derive_fresh_signal({"balances":{"ethereum":1000000}}, {"total_inbound_value":100, "total_outbound_value":75})
        self.assertEqual(signal["retention_ratio"], 0.25)

    def test_invalid_market_response_does_not_mutate_snapshot(self):
        data = {"meta":{"price_usd":1}}
        with self.assertRaises(ValueError):
            apply_market_data(data, {"market_data":{}})
        self.assertEqual(data, {"meta":{"price_usd":1}})

    def test_market_zero_circulating_is_valid_and_arithmetic_reconciles(self):
        data = {"meta":{"circulating_supply":999}}
        apply_market_data(data, {"market_data":{"current_price":{"usd":2}, "circulating_supply":0,
                                                "total_supply":1000, "last_updated":"2026-11-16T10:00:00Z"}})
        self.assertEqual(data["meta"]["market_cap"], 0)
        self.assertEqual(data["meta"]["fdv"], 2000)

    def test_rate_limit_retries_with_a_single_key(self):
        class Response(io.BytesIO):
            pass
        replies = [Response(b'{"result":"Max rate limit reached"}'), Response(b'{"status":"1","result":"123"}')]
        with patch.object(utils, "urlopen", side_effect=replies), patch.object(utils, "switch_api_key", return_value=False), \
             patch.object(utils.time, "sleep") as sleep:
            result = utils.fetch_json("https://example.com", retries=2)
        self.assertEqual(result["result"], "123")
        sleep.assert_called_once()


if __name__ == "__main__":
    unittest.main()
