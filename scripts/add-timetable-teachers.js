/**
 * scripts/add-timetable-teachers.js — populate teachers from the timetable.
 * --------------------------------------------------------------------------
 * One-time setup: removes the leftover test accounts (bla / cla / ishant) and
 * creates one teacher per subject used in the current timetable, so every
 * subject cell auto-matches a teacher (the app auto-detects a teacher in a
 * cell when exactly one teacher teaches that subject).
 *
 * Usage:  node scripts/add-timetable-teachers.js
 *
 * Idempotent — safe to re-run (subjects that already have a teacher are
 * skipped, so it only fills gaps).
 */
'use strict';

const db = require('../lib/db');

/** Password for every created account (admin can change it later). */
const PASSWORD = '1234';

/** Leftover test accounts removed by this script. */
const TEST_USERNAMES = ['bla', 'cla', 'ishant'];

/** Subject -> teacher name (login username is derived from the subject). */
const TEACHER_NAMES = {
  'Mathematics': 'Priya Verma',
  'Physics': 'Rahul Kapoor',
  'Chemistry': 'Sneha Iyer',
  'Biology': 'Meera Nair',
  'English': 'Farhan Khan',
  'Hindi': 'Amit Joshi',
  'Sanskrit': 'Kavita Sharma',
  'Social Studies': 'Rohan Das',
  'History': 'Anjali Singh',
  'Geography': 'Vikram Mehta',
  'Economics': 'Neha Gupta',
  'Accountancy': 'Sunil Kumar',
  'Business Studies': 'Pooja Reddy',
  'Computer Science': 'Arjun Patel',
  'Physical Education': 'Manish Yadav',
  'Art': 'Divya Menon',
  'Music': 'Aditya Bose',
};

function usernameFor(subject) {
  return String(subject).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// 1) Every subject actually used somewhere in the timetable
const tt = db.getTimetable();
const used = new Set();
(tt.classes || []).forEach((cls) =>
  (tt.days || []).forEach((d) =>
    (tt.periods || []).forEach((p) => {
      const cell = db.slotCell(tt, cls, d, p);
      if (cell && cell.subject) used.add(cell.subject);
    })
  )
);

// 2) Remove the leftover test accounts
console.log('Removing leftover test accounts…');
db.getUsers()
  .filter((u) => u.role === 'teacher' && TEST_USERNAMES.includes(String(u.username).toLowerCase()))
  .forEach((u) => {
    db.deleteTeacher(u.id);
    console.log(`  removed  ${u.username} (${u.name})`);
  });

// 3) Create one teacher per subject that has no teacher yet
const subjectsTaught = new Set(
  db.getUsers()
    .filter((u) => u.role === 'teacher' && u.subject)
    .map((u) => u.subject)
);

let created = 0;
[...used].sort().forEach((subject) => {
  if (subjectsTaught.has(subject)) {
    console.log(`  skip     ${subject} (already has a teacher)`);
    return;
  }
  const name = TEACHER_NAMES[subject] || subject;
  const username = usernameFor(subject);
  try {
    db.createTeacher({
      name,
      username,
      password: PASSWORD,
      email: `${username}@school.edu`,
      subject,
    });
    created++;
    console.log(`  created  ${username} / ${PASSWORD}  →  ${name} (${subject})`);
  } catch (e) {
    console.error(`  ERROR    ${subject}: ${e.message}`);
  }
});

console.log(`\nDone — ${created} teacher(s) created. Every subject in the timetable now has exactly one teacher.`);
