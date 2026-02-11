@echo off
color 0A
cls
echo ================================================
echo      KPSS PRO - GUNCELLEME BASLATIYOR
echo ================================================
echo.

echo [1/2] Proje derleniyor (Build)...
echo Lutfen bekleyin, bu islem biraz zaman alabilir.
echo ------------------------------------------------
call npm run build

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    echo HATA: Build isleminde bir sorun olustu.
    echo Lutfen yukaridaki hata mesajlarini kontrol et.
    echo !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    pause
    exit /b %errorlevel%
)

echo.
echo [2/2] Firebase'e gonderiliyor (Deploy)...
echo ------------------------------------------------
call firebase deploy

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    echo HATA: Deploy sirasinda bir sorun olustu.
    echo Internet baglantini veya giris durumunu kontrol et.
    echo !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    pause
    exit /b %errorlevel%
)

echo.
echo ================================================
echo      ISLEM BASARIYLA TAMAMLANDI!
echo      Siteniz guncellendi.
echo ================================================
echo.
pause