#!/usr/bin/env python3
"""
Shared CEX address registry for backend pipeline scripts.
All addresses must stay lowercase.
"""

KNOWN_CEX_ADDRESSES = {
    "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
    "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
    "0xb5bc3e38b5b683ce357ffd04d70354dcbbf813b2": "Binance",
    "0xfdd710fa25cf1e08775cb91a2bf65f1329ccbd09": "Binance",
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
    "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
    "0x3cd751e6b0078be393132286c442345e68ff0afc": "Coinbase",
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511": "Coinbase",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
    "0x6e1abc08ad3a845726ac93c0715be2d7c9e7129b": "Coinbase",
    "0x137f79a70fc9c6d5c80f94a5fc44bd95a567652d": "Coinbase",
    "0xaeee6e35eb33a464a82a51dbf52e85da137b6bcc": "Coinbase",
    "0x94e19e5c29a75b1b1bdcf247bb55425ca7d319d4": "Coinbase",
    "0xcd531ae9efcce479654c4926dec5f6209531ca7b": "Coinbase Prime",
    "0x91d40e4818f4d4c57b4578d9eca6afc92ac8debe": "OKX",
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
    "0x98ec059dc3adfbdd63429227115d9f17bebe7455": "OKX",
    "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
    "0x4a4aaa0155237881fbd5c34bfae16e985a7b068d": "OKX",
    "0xff8a035ea6c80673f741c2265985ed976a40d390": "OKX",
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
    "0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23": "Bybit",
    "0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4": "Bybit",
    "0xd9d93951896b4ef97d251334ef2a0e39f6f6d7d7": "Bybit",
    "0xa31231e727ca53ff95f0d00a06c645110c4ab647": "Bybit",
    "0xb8e6d31e7b212b2b7250ee9c26c56cebbfbe6b23": "KuCoin",
    "0xe8c15aad9d4cd3f59c9dfa18828b91a8b2c49596": "KuCoin",
    "0x175ce6204bfda2a509c7e9c786b74407f569c9cc": "KuCoin",
    "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
    "0xd793281b45cebbdc1e30e3e3e47d7c5e7713e23d": "HTX",
    "0x46340b20830761efd32832a74d7169b29feb9758": "HTX",
    "0x4fb312915b779b1339388e14b6d079741ca83128": "HTX",
    "0x63be42b40816eb08f6ea480e5875e6f4668da379": "Upbit",
    "0x6540f4a2f4c4fbac288fa738a249924a636020d0": "Upbit",
    "0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2": "Gemini",
    "0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88": "MEXC",
    "0x9642b23ed1e01df1092b92641051881a322f5d4e": "MEXC",
    "0xcc282e2004428939ee5149a9e7872f0b4d5d5ec7": "Kraken",
    "0xd2dd7b597fd2435b6db61ddf48544fd931e6869f": "Kraken",
    "0x7dafba1d69f6c01ae7567ffd7b046ca03b706f83": "Kraken",
    "0xa023f08c70a23abc7edfc5b6b5e171d78dfc947e": "Crypto.com",
    "0x5b71d5fd6bb118665582dd87922bf3b9de6c75f9": "Crypto.com",
    "0xab782bc7d4a2b306825de5a7730034f8f63ee1bc": "Bitvavo",
    "0x4680900fb91164ee22b9e8f7c66efc79d7c4e1f9": "Bithumb",
    "0x76ec5a0d3632b2133d9f1980903305b62678fbd3": "BTCTurk",
    "0x841ed663f2636863d40be4ee76243377dff13a34": "Robinhood",
    "0x9b0c45d46d386cedd98873168c36efd0dcba8d46": "Revolut",
}


KNOWN_COINBASE_ADDRESSES = {
    address for address, label in KNOWN_CEX_ADDRESSES.items() if label in ("Coinbase", "Coinbase Prime")
}
