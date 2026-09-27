#!/usr/bin/env python3
"""Export your Poden+ for Mac library to one file the web app imports (Settings → Library → Import…).

Copies shows, played state, positions, per-show settings, time saved, and every scan (interludes,
extras, ads, silence) and transcript the Mac app has made — so nothing needs rescanning.

    python3 tools/export-mac-library.py            → writes "Poden library.json" on your Desktop
"""
import hashlib, json, os, plistlib, sys

base = os.path.expanduser('~/Library/Application Support/Poden')
prefs_file = os.path.expanduser('~/Library/Preferences/com.example.poden.plist')
out = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Desktop/Poden library.json')

def load(p, d=None):
    try:
        with open(p) as f: return json.load(f)
    except Exception: return d

shows = load(os.path.join(base, 'library.json'), [])
meta = load(os.path.join(base, 'meta.json'), {})
positions = load(os.path.join(base, 'positions.json'), {'t': {}, 'recent': []})
try:
    with open(prefs_file, 'rb') as f: ud = plistlib.load(f)
except Exception: ud = {}

def eid(e, show):
    g = e.get('guid')
    return f"{show}#{g}" if g else e['audioURL']

analyses, transcripts = {}, {}
adir = os.path.join(base, 'Analysis')
for p in shows:
    for e in p.get('episodes', []):
        i = eid(e, p['feedURL'])
        h = hashlib.sha256(i.encode()).hexdigest()
        a = load(os.path.join(adir, h + '.analysis.json'))
        if a:
            analyses[i] = a
        t = load(os.path.join(adir, h + '.transcript.json'))
        if t:
            # compact: round times, keep what the web app uses
            for l in t.get('lines', []):
                l['start'] = round(l['start'], 2); l['end'] = round(l['end'], 2)
                for w in l.get('words') or []:
                    w['start'] = round(w['start'], 2); w['end'] = round(w['end'], 2)
                    if 'confidence' in w: w['confidence'] = round(w['confidence'], 2)
            transcripts[i] = t

keys = ['skipBack', 'skipForward', 'musicMode', 'trailerMode', 'adMode', 'textScale', 'skipSilence', 'autoDownload',
        'generateTranscripts', 'transcriptSize', 'removePlayed', 'theme', 'rate', 'volume', 'hideHeard']
settings = {k: ud[k] for k in keys if k in ud}
settings['autoDownload'] = min(settings.get('autoDownload', 0), 3)   # browsers have less room than a Mac

doc = {'app': 'Poden+', 'version': 1, 'from': 'mac', 'shows': shows, 'heard': ud.get('heard', []), 'positions': positions,
       'meta': {'prefs': meta.get('prefs', {}), 'upNext': meta.get('upNext', []), 'skipped': meta.get('skipped', {}),
                'skippedByKind': meta.get('skippedByKind', {})},
       'settings': settings, 'analyses': analyses, 'transcripts': transcripts}
with open(out, 'w') as f: json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
print(f"Wrote {out}: {len(shows)} shows, {sum(len(p['episodes']) for p in shows)} episodes, "
      f"{len(analyses)} scans, {len(transcripts)} transcripts ({os.path.getsize(out) / 1e6:.1f} MB)")
