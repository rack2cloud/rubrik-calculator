'use strict';
// Launches headless Chromium. Set CHROMIUM_PATH if the Playwright-managed browser is not installed.
const { chromium } = require('playwright');
module.exports = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
