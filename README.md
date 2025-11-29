# Two-Way Language Recognition

Real-time speech recognition and translation feature.

## Setup

1. Install dependencies:
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Create `.env` file:
```
AZURE_SPEECH_KEY=your_key
AZURE_REGION=westeurope
DEEPL_API_KEY=your_key
```

3. Run backend:
```bash
cd backend
python app.py
```
Server runs on `http://localhost:3000`

4. Open frontend:
```bash
cd frontend
python3 -m http.server 8080
```
Open `http://localhost:8080`

## Architecture

```
Frontend (React Hook) -> WebSocket -> Backend (Flask) -> Azure Speech -> DeepL
```

## Project Structure

```
backend/
  app.py              # Flask app
  routes/
    websocket.py      # WebSocket handlers
  services/
    speech_service.py
    translation_service.py
frontend/
  index.html          # Basic demo
  src/
    demo.js           # Client logic
    hooks/            # React hooks (to be built)
```

## WebSocket Events

Client -> Server:
- `join_room`
- `start_realtime_recognition`
- `realtime_audio_chunk`
- `stop_realtime_recognition`

Server -> Client:
- `realtime_transcription`
- `realtime_translation`
- `error`
