// src/engine/core/pipeline.js — נקודת הכניסה היחידה של מנוע המורשת (המנוע הישן)
'use strict';

/**
 * **ריפו הגיבוי של המנוע הישן (Tora_Book_Typesetter_Red_Old):**
 * מאגר זה משמר את המנוע הישן בלבד — הפורט הנאמן של מנוע העימוד המקורי
 * (פרופיל IMUD, legacy-imud-flow.js). המנוע המאוחד (DP) הוסר מכאן
 * בשלמותו וממשיך להתפתח במאגר המרכזי (Tora_Book_Typesetter_Red_Work_2).
 *
 * ההכרעה כאן פשוטה ומפורשת:
 *   - הגדרות IMUD (layout-profile='imud' + _imudRaw, כמו ש-importImudSettings
 *     מסמן מ-default_settings.json המקורי) ⇒ legacyTypeset — הדרך היחידה.
 *   - כל קלט אחר ⇒ שגיאה מפורשת (אין נפילה שקטה למנוע שאינו קיים כאן).
 *
 * מקורות האמת של המנוע הישן נותרו ללא שינוי:
 *   1. audits/layout-reference.json — החילוץ המתמטי של פלט הגרסה הישנה
 *      (הצהובה) מקובצי ה-PDF שהעלה המשתמש, כולל הסימון הגיאומטרי.
 *   2. התנהגות המקור היא המפרס — כולל הגיאומטריה המדויקת שנמדדה מקובצי
 *      הייחוס (בקשת 03.11: "בדיקת עימוד מתמטית ומוחלטת דרך וורקפלו").
 */

function typeset(rawText, settingsIn, env = {}) {
  if (settingsIn && settingsIn['_layout-profile'] === 'imud' && settingsIn._imudRaw) {
    const { legacyTypeset } = require('../layout/legacy-imud-flow');
    return legacyTypeset(rawText, settingsIn, env);
  }
  // **אין מנוע מאוחד במאגר זה:** הודעה עברית מפורשת במקום נפילה שקטה.
  // אם מגיעות הגדרות ללא פרופיל IMUD — זו שגיאת שימוש: יש לייבא הגדרות
  // מקור (importImudSettings מ-default_settings.json) לפני העימוד.
  throw new Error(
    'pipeline: פרופיל העימוד אינו IMUD — מאגר זה מריץ את המנוע הישן בלבד. '
    + 'ייבאו את הגדרות המקור (default_settings.json) דרך importImudSettings לפני הקריאה ל-typeset.'
  );
}

module.exports = { typeset };
