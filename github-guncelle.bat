@echo off
title Github Otomatik Guncelleyici
color 0A

echo -----------------------------------------
echo GITHUB'A YUKLEME ISLEMI BASLATILIYOR...
echo -----------------------------------------

:: 1. Tüm değişiklikleri ekle
git add .

:: 2. Commit mesajı al (Enter'a basarsan otomatik tarih atar)
set /p "mesaj=Ozel bir commit mesaji yazin (Bos gecerseniz tarih/saat atilir): "

:: Eğer mesaj boşsa tarih ve saati mesaj olarak ayarla
if "%mesaj%"=="" set mesaj=Otomatik Guncelleme: %date% %time%

:: 3. Commit işlemini yap
git commit -m "%mesaj%"

:: 4. Github'a gönder
git push origin main

echo.
echo -----------------------------------------
echo ISLEM BASARIYLA TAMAMLANDI!
echo -----------------------------------------
:: Pencerenin hemen kapanmaması, sonucu görmen için:
timeout /t 3