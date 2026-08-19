/**
 * Regenerates sample-timetable.xlsx / sample-timetable.csv in the project root.
 * Usage:  node scripts/generate-sample.js
 * (The server also regenerates these files automatically on first run.)
 */
'use strict';

const db = require('../lib/db');

db.writeSampleFiles();
console.log('Sample files regenerated:');
console.log('  - sample-timetable.xlsx');
console.log('  - sample-timetable.csv');
