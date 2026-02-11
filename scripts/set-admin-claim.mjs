import process from 'node:process';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [, , email] = process.argv;

if (!email) {
  console.error('Kullanim: npm run set-admin-claim -- <admin-email>');
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON env degiskenini ayarlayin.');
  console.error('Ornek: set GOOGLE_APPLICATION_CREDENTIALS_JSON={...service account json...}');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
} catch (error) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON parse edilemedi.');
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const auth = getAuth();

try {
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { admin: true });
  await auth.revokeRefreshTokens(user.uid);
  console.log(`Admin claim verildi: ${email} (uid: ${user.uid})`);
  console.log('Kullanicinin tekrar giris yapmasi gerekir.');
} catch (error) {
  console.error('Admin claim atanamadi:', error);
  process.exit(1);
}
