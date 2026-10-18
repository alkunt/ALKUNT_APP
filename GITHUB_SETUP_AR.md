# ربط مشروع ALKUNT بـ GitHub

## ما تم تجهيزه

- مستودع Git محلي بفرع `main`.
- استبعاد ملفات البيئة وقواعد البيانات وبيانات المسجلين والمحتوى الخاص والمرفقات والنسخ الاحتياطية.
- تثبيت إصدار Node الرئيسي على 24 في `.nvmrc`، مع ملف `package-lock.json` للتثبيت المتكرر.
- توحيد نهايات الأسطر عبر `.gitattributes`.
- فحص تلقائي عبر GitHub Actions عند الدفع إلى `main` وطلبات الدمج: الاختبارات، TypeScript، بناء الإنتاج واختبارات HTTP.
- لم يُضبط رابط مستودع بعيد، ولم يُنشأ مستودع على GitHub ولم تُرفع أي ملفات.

## خطوات الربط

أنشئ مستودعاً فارغاً في حسابك على GitHub، ثم نفّذ من مجلد المشروع بعد استبدال `YOUR_ACCOUNT` و`YOUR_REPOSITORY` بالقيم الفعلية:

```sh
git status --short
git add .
git diff --cached --stat
git commit -m "Prepare ALKUNT application"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

إن طلب Git هوية الكاتب، اضبط اسمك وبريد GitHub لهذا المستودع بواسطة `git config user.name` و`git config user.email`. سجّل الدخول باستخدام وسيلة GitHub المعتمدة لديك؛ لا تضع رمز الدخول في الرابط أو ملفات الكود.

لمراجعة استبعاد البيانات قبل الرفع:

```sh
git check-ignore .env.local data/alkunt.sqlite data/content/catalog.json data/registered-users.json backups/
```

## عند النشر

اضبط متغيرات البيئة على الخادم، واربط تخزيناً دائماً لمجلد `data` أو Docker volume. انقل المحتوى والحسابات والمرفقات عبر نسخة احتياطية خاصة، ثم اتبع [دليل النشر](README_AR.md). رفع الكود إلى GitHub وحده لا ينقل بيانات الموقع ولا ينشره تلقائياً.

مرجع إعداد Node في الفحوص التلقائية: [actions/setup-node](https://github.com/actions/setup-node).
