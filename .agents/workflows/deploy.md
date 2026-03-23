---
description: Push changes to GitHub and trigger both workflows
---
// turbo-all

1. Check for uncommitted changes:
```
cd /Users/adamszybki/Desktop/Draft/ZRO && git status --short
```

2. If there are changes, commit and push:
```
cd /Users/adamszybki/Desktop/Draft/ZRO && git add -A && git commit -m "📊 Update $(date -u +'%Y-%m-%d %H:%M UTC')" && git pull --rebase -X ours origin master && git push origin master
```

3. Trigger Daily Full Holder Scan workflow:
```
gh workflow run "Daily Full Holder Scan" --repo Twojekrypto/LayerZero
```

4. Trigger Hourly Monitor workflow:
```
gh workflow run "Hourly Monitor" --repo Twojekrypto/LayerZero
```

5. Verify workflows started:
```
gh run list --repo Twojekrypto/LayerZero --limit 4
```
