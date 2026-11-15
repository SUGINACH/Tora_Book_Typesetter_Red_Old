# הוספת פריט עימוד מותאם — S14

## עקרון העבודה

פריט מותאם נרשם פעם אחת בקובץ מודול, אך קוד הרישום נטען בנפרד בכל סביבת הריצה:
- Headless/Node דרך `engine/core/pipeline.js`.
- Worker בדפדפן דרך `ui/engine-worker-main.js`.
- UI בדפדפן דרך `ui/browser-entry.js`.

הכניסה המשותפת היא `src/engine/layout/inline-item-types.js`. **כל מודול פריט חדש נוסף אליה פעם אחת בלבד.** אין לשלוח פונקציות ב-`postMessage`, אין `eval`, ואין רישום ידני נפרד ב-UI וב-Worker.

## מבנה מודול

יוצרים למשל `src/engine/layout/inline-items/my-item.js`:

```js
'use strict';

const { registerInlineItemType } = require('../inline-item-registry');

registerInlineItemType('my-item', {
  // אופציונלי: זיהוי תחביר המקור. חייב להיות טהור ודטרמיניסטי.
  parse(source, index) {
    const match = source.slice(index).match(/^⟦item:([^⟧]+)⟧/u);
    if (!match) return null;
    const value = match[1];
    return {
      consumed: match[0].length,
      item: {
        kind: 'my-item',
        id: 'my-item:' + value,
        layoutKey: value,
        payload: { value }
      }
    };
  },

  // אופציונלי: אימות מטען לפני המדידה ואחריה.
  validate(item) {
    return typeof item.payload?.value === 'string'
      && item.layoutKey === item.payload.value;
  },

  // אופציונלי: מידות מחושבות; אין לקרוא DOM או למדוד DOM כאן.
  measure(item) {
    return {
      widthPx: 32,
      heightPx: 20,
      layoutKey: item.layoutKey
    };
  },

  // חובה: מחזיר תוכן בלבד. המנוע עוטף אותו בתיבה שמידותיה נמדדו.
  dom(fragment, document) {
    const node = document.createElement('span');
    node.textContent = fragment.payload.value;
    return node;
  },

  // חובה: מחזיר אופרטורי PDF. קואורדינטות המקטע כבר הוקצו ע"י המקרן.
  pdf(fragment, context) {
    const x = fragment.x * context.pxToPt;
    const y = context.pageHeightPt
      - (fragment.y + fragment.heightPx) * context.pxToPt;
    const w = fragment.widthPx * context.pxToPt;
    const h = fragment.heightPx * context.pxToPt;
    return [
      context.round2(x) + ' ' + context.round2(y) + ' '
        + context.round2(w) + ' ' + context.round2(h) + ' re f'
    ];
  }
});
```

לאחר מכן מוסיפים **שורת import אחת** אל `src/engine/layout/inline-item-types.js`:

```js
require('./inline-items/my-item');
```

המודול המשותף נכלל אוטומטית בחבילת ה-Worker ובחבילת ה-UI. לאחר שינוי כזה יש להריץ `node tools/build-worker-bundle.js` מתוך `red-build` ולצרף את שני ה-bundles המעודכנים.

## חוזה מחייב

1. `kind` ייחודי ואינו יכול לדרוס סוג מובנה.
2. `id` יציב וייחודי למופע; `layoutKey` מתאר את המאפיינים שמשפיעים על הפריסה ונכלל בטביעת הגאומטריה.
3. ה-Parser מחזיר `{ consumed, item }`; ה-Registry שומר בעצמו את קטע המקור המדויק ומחשב טווחי מקור.
4. ה-Measurer מחזיר רוחב וגובה סופיים, סופיים מספרית ולא שליליים. מדידה אינה תלויה ב-DOM.
5. ה-DOM renderer מספק תוכן בלבד. הוא אינו רשאי לשנות את המידות שהוקצו ע"י Knuth–Plass.
6. ה-PDF renderer מחזיר מערך מחרוזות של PDF operators; שגיאה או היעדר renderer הם כשל מפורש, לא השמטה שקטה.
7. אין לפרש תחביר פריטים בתוך הערות שוליים/סיום אלא אם יתווסף לכך חוזה מפורש; כרגע ה-Parser חוסם זאת.
8. שני Parsers שתופסים אותו מקטע מקור גורמים לשגיאה דטרמיניסטית. אין תלות בסדר הרישום.
9. מודול הפריט חייב להיטען בכניסת ה-UI, בכניסת ה-Worker וב-pipeline של Headless דרך נקודת הכניסה המשותפת.

## בדיקות קבלה לפריט חדש

הפריט אינו נחשב משולב עד שבדיקות מכסות:
- parse ושימור זהות המקור;
- אימות לפני מדידה ואחריה;
- מדידה, שבירת שורות ו-DP;
- מיקום גאומטרי ב-Page Model;
- DOM בתוך התיבה שנמדדה;
- PDF עם מידות/קואורדינטות תואמות;
- אותה ריצה דרך Worker אמיתי, לצד headless;
- דטרמיניזם, שימור תוכן ו-hash גאומטרי.
