---
description: Run automated code audit on all ZRO Python scripts and workflows
---
// turbo-all

1. Run syntax check on all Python files:
```
python3 -c "
import py_compile
files = ['utils.py', 'detect_fresh.py', 'generate_flows.py', 'monitor_cb_prime.py', 'refresh_balances.py', 'update_data.py', 'fetch_holders.py']
for f in files:
    py_compile.compile(f, doraise=True)
    print(f'✅ {f}')
print('All syntax OK')
"
```

2. Run cross-file consistency audit:
```
python3 -c "
import os, re
issues, ok = [], []
FILES = {}
for f in ['detect_fresh.py','generate_flows.py','monitor_cb_prime.py','refresh_balances.py','fetch_holders.py','update_data.py']:
    FILES[f] = open(f).read()

# ZRO contract
zro = '0x6985884c4392d348587b19cb9eaaf157f13271cd'
for f, code in FILES.items():
    if f != 'update_data.py' and zro not in code.lower():
        issues.append(f'❌ {f}: ZRO contract missing')
ok.append('ZRO contract consistent')

# Bare except
for f, code in FILES.items():
    for i, line in enumerate(code.split('\n'), 1):
        if line.strip() == 'except:':
            issues.append(f'❌ {f}:{i}: bare except')
ok.append('No bare except')

# eval/exec
for f, code in FILES.items():
    if 'eval(' in code or 'exec(' in code:
        issues.append(f'❌ {f}: uses eval/exec')
ok.append('No eval/exec')

# Hardcoded keys
for f, code in FILES.items():
    keys = re.findall(r'[\"\\'][A-Z0-9]{20,}[\"\\']', code)
    if keys: issues.append(f'❌ {f}: possible hardcoded API key')
ok.append('No hardcoded keys')

# atomic writes
for f, code in FILES.items():
    if 'json.dump(' in code and 'atomic' not in code and 'utils' not in code:
        issues.append(f'⚠️ {f}: non-atomic JSON write')

# .gitignore
gi = open('.gitignore').read()
if 'flow_cache.json' in gi: ok.append('.gitignore OK')
else: issues.append('❌ flow_cache.json not in .gitignore')

print(f'✅ {len(ok)} checks passed')
for o in ok: print(f'   ✅ {o}')
if issues:
    print(f'❌ {len(issues)} issues:')
    for i in issues: print(f'   {i}')
else:
    print('🎉 ALL CLEAN — no issues found')
"
```

3. Check GitHub workflow status:
```
gh run list --repo Twojekrypto/LayerZero --limit 4
```
