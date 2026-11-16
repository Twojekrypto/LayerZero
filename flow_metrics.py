"""Calculations and transfer identity shared by flow ingestion and normalization."""


def period_retention(total_in, total_out):
    """Share of period inflows left after period outflows; old balances add no credit."""
    incoming = float(total_in or 0)
    outgoing = float(total_out or 0)
    return round(max(0.0, min(1.0, (incoming - outgoing) / incoming)), 4) if incoming > 0 else 0.0


def transfer_identity(transfer):
    base = (transfer.get("chain", ""), transfer.get("hash", "").lower())
    log_index = transfer.get("log_index")
    if log_index not in (None, ""):
        return base + (str(int(str(log_index), 0)) if str(log_index).startswith("0x") else str(int(log_index)),)
    return base + (
        transfer.get("from", "").lower(), transfer.get("to", "").lower(),
        str(transfer.get("value", 0)), int(transfer.get("timestamp", 0)),
    )


def merge_transfers(existing, incoming):
    # Replace matching legacy rows only when the new API response supplies chain evidence.
    def fingerprint(tx):
        return (tx.get("hash", "").lower(), tx.get("from", "").lower(), tx.get("to", "").lower(),
                float(tx.get("value", 0)), int(tx.get("timestamp", 0)))
    legacy_keys = {(tx.get("chain", ""), fingerprint(tx)) for tx in incoming}
    incoming_fingerprints = {fingerprint(tx) for tx in incoming}
    merged = {
        transfer_identity(tx): tx for tx in existing
        if not ((not tx.get("chain") and fingerprint(tx) in incoming_fingerprints)
                or (tx.get("log_index") in (None, "") and (tx.get("chain", ""), fingerprint(tx)) in legacy_keys))
    }
    before = len(merged)
    for tx in incoming:
        merged[transfer_identity(tx)] = tx
    return list(merged.values()), len(merged) - before
