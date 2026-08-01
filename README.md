# Rub to Reveal

A small site that shows a series of pictures stacked on top of each other. Drag
a heart-shaped cursor across the top one and it wears away in heart-shaped
strokes, revealing the next picture underneath. Rub away enough of it and the
rest dissolves on its own, the next picture takes its place, and you start again
— all the way through the series, then back to the beginning.

Plain HTML, CSS and JavaScript. No build step, no dependencies, no framework.

## Putting your own pictures in

1. Drop your image files into the `images/` folder. JPG, PNG, WebP, GIF and SVG
   all work.
2. Open `config.js` and list them in the order you want them revealed:

   ```js
   images: [
     { src: "images/sunrise.jpg",  caption: "First light" },
     { src: "images/harbour.jpg",  caption: "Low tide" },
     { src: "images/orchard.jpg",  caption: "Bloom" }
   ],
   ```

   The first one in the list is what people see first; rubbing it away reveals
   the second, and so on. `caption` is optional — leave it as `""` if you'd
   rather show nothing.
3. Delete the five `images/0*.svg` placeholders once you don't need them.

That's the whole job. `config.js` is the only file you need to touch.

### The other settings in `config.js`

| Setting | What it does |
| --- | --- |
| `title`, `subtitle` | The headings at the top of the page. |
| `hint` | The line of instructions under the buttons. |
| `aspectRatio` | Shape of the frame — `"4 / 3"`, `"3 / 2"`, `"16 / 9"`, `"1 / 1"`. Pictures are cropped to fill it, centred. |
| `brushSize` | How wide the heart brush is, in pixels, on a big screen. It scales down on smaller ones. |
| `revealThreshold` | How much has to be rubbed away before the rest dissolves. `0.55` is 55%. |
| `loop` | `true` goes back to the first picture after the last one. `false` stops at the end. |
| `softEdge` | `true` feathers the brush edges. `false` gives a hard-edged cut-out. |

A note on picture sizes: everything is cropped to fill the frame, so pictures
roughly matching your `aspectRatio` will lose the least off their edges. Around
1600px on the long side is plenty — much larger and the page just takes longer
to load.

## Putting it online with GitHub Pages

1. Commit and push these files to your repository.
2. On GitHub go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   pick the branch you pushed to, keep the folder as `/ (root)`, and **Save**.
4. Wait a minute, then visit `https://<your-username>.github.io/<repo-name>/`.

Every push to that branch updates the live site.

## Looking at it on your own machine first

Opening `index.html` by double-clicking mostly works, but browsers restrict
local files in ways that can trip up image loading. Serving the folder is more
reliable — from inside it, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## How it works

Two canvases sit on top of each other inside the frame. The lower one holds the
next picture, the upper one holds the current picture. Scrubbing stamps a
pre-rendered heart into the upper canvas using a `destination-out` composite,
which punches a heart-shaped hole rather than painting anything — so the
picture below shows through.

Coverage is tracked on a coarse grid that ticks off cells as the brush passes
over them, instead of reading pixels back from the canvas. It's faster, and it
keeps working when the page is opened straight off disk.

When the threshold is crossed the upper canvas fades out. The swap underneath
that fade is ordered so nothing flickers: the upper canvas is repainted with the
picture you're already looking at while it's still invisible, snapped back to
full opacity (identical pixels, so nothing appears to change), and only then is
the following picture drawn underneath, hidden behind it.

Every stamp is also recorded as a fraction of the frame's size, so when the
window is resized the erased area is replayed at the new dimensions instead of
being lost.

## Accessibility

Rubbing isn't the only way through. **Reveal this one** advances the series with
a click, and the frame itself is focusable — tab to it and press <kbd>Enter</kbd>
or <kbd>Space</kbd>. Each change is announced to screen readers, and the
floating hearts and fades are dropped for anyone who has asked their system to
reduce motion.

## Files

```
index.html     page structure
config.js      your pictures and settings  ← the one to edit
script.js      the rub-out engine
styles.css     styling, light and dark
images/        your pictures (five placeholders to start with)
```
