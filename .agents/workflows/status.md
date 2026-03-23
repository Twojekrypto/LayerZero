---
description: Check status of running GitHub Actions workflows with logs
---
// turbo-all

1. List recent workflow runs:
```
gh run list --repo Twojekrypto/LayerZero --limit 6
```

2. Show details of the most recent Daily scan:
```
gh run list --repo Twojekrypto/LayerZero --workflow="update-data.yml" --limit 1 --json databaseId,status,conclusion,startedAt -q '.[0]' 2>/dev/null && echo "" && gh run list --repo Twojekrypto/LayerZero --workflow="update-data.yml" --limit 1 --json databaseId -q '.[0].databaseId' | xargs -I{} gh run view {} --repo Twojekrypto/LayerZero --log 2>/dev/null | tail -20
```

3. Show details of the most recent Hourly monitor:
```
gh run list --repo Twojekrypto/LayerZero --workflow="hourly-monitor.yml" --limit 1 --json databaseId,status,conclusion,startedAt -q '.[0]' 2>/dev/null && echo "" && gh run list --repo Twojekrypto/LayerZero --workflow="hourly-monitor.yml" --limit 1 --json databaseId -q '.[0].databaseId' | xargs -I{} gh run view {} --repo Twojekrypto/LayerZero --log 2>/dev/null | tail -20
```
