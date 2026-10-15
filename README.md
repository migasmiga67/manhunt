# Manhunt (React + Node + Socket.IO)

Struktura: `server/` (Express + Socket.IO), `client/` (Vite + React + Leaflet/OpenStreetMap, bez klucza API).

## Uruchomienie lokalnie
    cd server && npm install && npm run dev     # port 3001
    cd client && npm install && cp .env.example .env && npm run dev
GPS na telefonie wymaga HTTPS, więc do testów w terenie użyj deployu poniżej.

## Deploy
Vercel nie trzyma stałych połączeń WebSocket, więc backend idzie osobno:
1. **Backend na Render** (Web Service): Root Directory `server`, Build `npm install`, Start `npm start`. Skopiuj adres, np. https://manhunt.onrender.com
2. **Frontend na Vercel**: Root Directory `client`, framework Vite, zmienna `VITE_SERVER_URL` = adres z Render.
3. Otwórz stronę Vercel na telefonach, zezwól na lokalizację, jeden gracz zakłada pokój, reszta wpisuje kod.

## Zasady w apce
- Host ustawia teren (koło), tryb (zaraza/klasyczny), liczbę łowców, czasy i interwał radaru.
- Łowcy mają czarny ekran w czasie chowania. Po starcie widzą uciekinierów tylko w momencie radaru.
- Złapanie: łowca klika "Złap", serwer sprawdza, czy uciekinier jest w promieniu 25 m.
- Uciekinier poza kołem dostaje ostrzeżenie.

## Ograniczenia prototypu
Stan w pamięci serwera (restart kasuje pokoje), brak powrotu do gry po rozłączeniu, ekran musi być włączony przy GPS.
