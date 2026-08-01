/* ---------------------------------------------------------------------------
   EDIT THIS FILE — it is the only one you need to touch.

   1. Drop your pictures into the images/ folder.
   2. List them below, in the order you want them revealed.
      The first one in the list is the one people see first; rubbing it away
      reveals the second, and so on.
   3. Save, commit, push. That's it.
--------------------------------------------------------------------------- */

window.SITE_CONFIG = {

  // Shown at the top of the page.Scrub across the picture with your heart to wear it away.
  title: "Rub to Reveal",
  subtitle: "",

  // The little line of instructions under the buttons.Click and drag across the image — or drag with a finger on a phone.
  hint: "",

  images: [
    { src: "images/01.svg", caption: "First light" },
    { src: "images/02.svg", caption: "Low tide" },
    { src: "images/03.svg", caption: "Bloom" },
    { src: "images/04.svg", caption: "Small hours" },
    { src: "images/05.svg", caption: "Field notes" }
  ],

  // ---- Look and feel -------------------------------------------------------

  // Shape of the frame. Pictures are cropped to fill it, centred.
  // Try "4 / 3", "3 / 2", "16 / 9" or "1 / 1".
  aspectRatio: "4 / 3",

  // Width of the heart brush, in pixels, on a large screen.
  // It scales down automatically on smaller ones.
  brushSize: 100,

  // How much of the picture has to be rubbed away before the rest
  // dissolves on its own. 0.55 = 55%.
  revealThreshold: 0.60,

  // After the last picture, go back to the first one and keep going.
  loop: false,

  // Softly feathered brush edges. Set to false for a hard-edged cut-out.
  softEdge: true
};
