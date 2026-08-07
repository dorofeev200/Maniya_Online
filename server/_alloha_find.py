import json, urllib.request
H = {'User-Agent': 'Mozilla/5.0'}
def get(p):
    r = urllib.request.Request(p, headers=H)
    try:
        return urllib.request.urlopen(r, timeout=25).read().decode('utf8', 'replace')
    except Exception as e:
        return 'ERR ' + str(e)
repo = '/repos/immisterio/Lampac/git/trees/master?recursive=1'
tree = get('https://api.github.com' + repo)
try:
    d = json.loads(tree)
    paths = [e['path'] for e in d.get('tree', [])]
    print('tree entries:', len(paths))
except Exception as e:
    print('parse err:', e)
    paths = []
for p in paths:
    low = p.lower()
    if ('alloha' in low) or ('aloha' in low):
        print('ALLOHA:', p)
# also list a few relevant config / appconfig files
for p in paths:
    if p.lower().endswith('.json') and ('lampaconfig' in p.lower() or 'appsettings' in p.lower() or 'config' in p.lower()):
        print('CFG:', p)