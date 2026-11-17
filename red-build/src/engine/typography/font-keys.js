// src/engine/typography/font-keys.js — מפתח משפחת גופן רשומה ⇒ תת-גופן ייצוא (S73)
'use strict';

/**
 * **מקור יחיד למיפוי משפחה→מפתח גופן** (הוצא מכפילות: עד כאן היו שני עותקים
 * זהים — core/materialize.js ו-layout/structural-stamps.js — ועותק שלישי
 * במקרן המורשת שייסגר בשלב 9). המיפוי טהור: בדיקת רישום בלבד (registeredFonts),
 * בלי מדידה ובלי תלות ברנדרר.
 *
 * משפחה רשומה ⇒ המשפחה עצמה כמפתח (תת-גופן ייעודי בייצוא); אחרת null
 * (=גוף הטקסט /F1). התפקידים הפונקציונליים (window/fnbody/margin/heading)
 * ממופים לשמות הקצרים של תתי-הגופנים ב-pdf-writer.
 */

const { registeredFonts } = require('./measure-api');

/** @param {string} fam — שם משפחה מההגדרות (heading-N-font וכו'); ריק ⇒ null */
function familyFontKeyOf(fam) {
  if (!fam || !registeredFonts.has(fam)) return null;
  if (fam === 'Frank Ruhl Libre') return 'fnbody';
  if (fam === 'Hadassah Friedlaender') return 'margin';
  if (fam === 'FrankReal-Bold' || fam === 'FrankReal') return 'window';
  if (fam === 'David Libre' || fam === 'DavidLibre-Bold') return 'heading';
  return fam;
}

module.exports = { familyFontKeyOf };
