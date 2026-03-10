#!/usr/bin/env node
// Generates all required PNG icon sizes from the master SVG.
// Run: node scripts/generate-icons.js
// Requires: npm install --save-dev sharp

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SVG_INPUT = path.join(__dirname, '../public/icons/icon.svg');
const OUTPUT_DIR = path.join(__dirname, '../public/icons');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generate() {
  if (!fs.existsSync(SVG_INPUT)) {
    console.error('ERROR: icon.svg not found at', SVG_INPUT);
    process.exit(1);
  }

  console.log('Generating icons from', SVG_INPUT);

  for (const size of SIZES) {
    const output = path.join(OUTPUT_DIR, `icon-${size}.png`);
    await sharp(SVG_INPUT)
      .resize(size, size)
      .png()
      .toFile(output);
    console.log(`  ✓ icon-${size}.png`);
  }

  console.log('\nAll icons generated in', OUTPUT_DIR);
}

generate().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
