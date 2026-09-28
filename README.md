# Poden+ for the web

Poden+ on any computer or phone: the same app as Poden+ for Mac, running in the browser. It needs no server, no account and no build step. Everything stays on the device.

## Put it on GitHub Pages

1. Create a repository (for example `poden`) and upload **the contents of this `web/` folder** to its root. 
2. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`** and click Save.
3. About a minute later it's live at `https://<you>.github.io/poden/`.

All paths are relative, so it works from any sub-folder. `.nojekyll` is included so GitHub serves every file as-is.

## On a phone: true full screen, like an app

- **iPhone:** open the site in Safari, then **Share → Add to Home Screen**. Launched from the icon, it runs full screen with no Safari bars, has its own app switcher card, and keeps playing when you lock the phone or open another app. Lock screen and Control Centre controls work (play/pause, ±skip, scrubbing). Tapping the full-screen button in Safari shows these steps.
- **Android:** use the full-screen button, or Chrome **⋮ → Install app**.
- **Leaving the app:** when you switch away while an episode plays, Poden+ drops back to the mini player and the audio keeps going. The system media controls then act as the mini player on the lock screen and in the notification shade or Control Centre.


## How the skipping works in a browser

Browsers don't include Apple's sound classifier, so Poden+ web has its own detector:

- A small neural network, trained on episodes Poden+ for Mac had already analysed, labels every second as speech, music or trailer. It works from loudness, spectral and rhythm features.
- The Mac app's rules then run unchanged on top of those labels: merging, trailer cues, loudness growth, silence, audio fingerprints for jingles repeated across episodes, ads by language, transcript "voids" and automatic chapters.
- Measured on episodes it did **not** train on, against the Mac app's results: about 91 % of the time the Mac skips is found, and about 85 % of what the web version skips matches the Mac.
- Speed: a 3-hour episode scans in roughly 10–25 s in a background worker, so the interface never stutters. retrains the model if you want to recalibrate.

## Good to know

- **Feeds and CORS:** most podcast hosts don't let web pages read their feeds. Poden+ tries the direct address and several relays at once, uses whichever answers first, and remembers it per host. If every relay fails, it falls back to Apple's podcast directory, which lists the latest 300 episodes.
- **Skipping on some hosts:** audio from some hosts, such as Pixel Bento's podtrac links, **plays fine** but can't be *read* by web pages, so it can't be scanned. Those episodes show "Skipping unavailable for this host". Scans imported from Poden+ for Mac still work for them. For full coverage, add your own relay in **Settings → Network**, for example a free Cloudflare Worker.
- **After an update:** the app always loads the newest version when online and falls back to the saved copy when offline.
- **Downloads** go into the browser's storage and play offline with instant seeking.
- **Transcripts:** published transcripts (Podcasting 2.0) are used automatically. Transcripts made by the Mac app come across with the library import.
