# Two-Way Language Recognition

A real-time speech recognition and translation system that enables bidirectional communication across multiple languages. This feature allows users to speak in one language and receive instant transcriptions and translations in multiple target languages.

## 🌟 Features

- **Real-time Speech Recognition**: Uses Azure Speech SDK for accurate, real-time speech-to-text conversion
- **Multi-language Translation**: Supports translation to multiple target languages simultaneously using DeepL API
- **WebSocket Communication**: Low-latency bidirectional communication for live transcription and translation
- **Room-based Architecture**: Supports multiple concurrent sessions with room-based isolation
- **Language Support**: Supports 20+ languages including English, Spanish, French, German, Latvian, Lithuanian, Estonian, and more

## 🏗️ Architecture

```
┌─────────────┐         WebSocket          ┌──────────────┐
│   Client    │ ◄────────────────────────► │   Backend    │
│  (Browser)  │                            │   (Flask)    │
└─────────────┘                            └──────────────┘
      │                                            │
      │ Audio Stream                               │
      │                                            │
      ▼                                            ▼
┌─────────────┐                            ┌──────────────┐
│  Microphone │                            │ Azure Speech │
└─────────────┘                            │     SDK      │
                                           └──────────────┘
                                                    │
                                                    ▼
                                           ┌──────────────┐
                                           │  DeepL API   │
                                           │ Translation  │
                                           └──────────────┘
```

## 📋 Prerequisites

- Python 3.9+
- Azure Speech Service account and API key
- DeepL API key (free tier available)
- Modern web browser with microphone access

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/fadejevs/twoway-language-recognition.git
cd twoway-language-recognition
```

### 2. Install Dependencies

```bash
cd backend
pip install -r ../requirements.txt
```

### 3. Configure Environment Variables

Create a `.env` file in the `backend` directory:

```bash
# Azure Speech Service
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_REGION=westeurope

# DeepL Translation
DEEPL_API_KEY=your_deepl_api_key

# Optional
SECRET_KEY=your_secret_key
```

### 4. Run the Backend

```bash
cd backend
python app.py
```

The server will start on `http://localhost:5000`

### 5. Open the Frontend Demo

Open `frontend/index.html` in your web browser, or serve it using a local server:

```bash
cd frontend
python -m http.server 8000
```

Then navigate to `http://localhost:8000`

## 📖 Usage

1. **Connect**: Click "Connect" to establish WebSocket connection
2. **Configure**: Select source language and target languages
3. **Start Recognition**: Click "Start Recognition" and allow microphone access
4. **Speak**: Start speaking in the source language
5. **View Results**: See real-time transcriptions and translations appear

## 🔌 API Events

### Client → Server

- `join_room`: Join a room for receiving translations
- `start_realtime_recognition`: Start real-time speech recognition
- `realtime_audio_chunk`: Send audio data chunks
- `stop_realtime_recognition`: Stop recognition session

### Server → Client

- `connection_success`: Connection established
- `realtime_recognition_started`: Recognition session started
- `realtime_transcription`: Real-time transcription updates
- `realtime_translation`: Translation results
- `translation_result`: Final translation result
- `error`: Error messages

## 🛠️ Technical Details

### Backend Stack

- **Flask**: Web framework
- **Flask-SocketIO**: WebSocket support
- **Azure Speech SDK**: Speech recognition
- **DeepL API**: Translation service
- **Gevent**: Async I/O

### Frontend Stack

- **Socket.IO Client**: WebSocket communication
- **Web Audio API**: Microphone access and audio processing
- **Vanilla JavaScript**: No framework dependencies

## 📁 Project Structure

```
twoway-language-recognition/
├── backend/
│   ├── app.py                 # Main Flask application
│   ├── routes/
│   │   └── websocket.py       # WebSocket event handlers
│   └── services/
│       ├── speech_service.py  # Azure Speech SDK wrapper
│       └── translation_service.py  # DeepL translation wrapper
├── frontend/
│   ├── index.html            # Demo UI
│   └── src/
│       └── demo.js           # Client-side logic
├── requirements.txt          # Python dependencies
└── README.md                # This file
```

## 🌍 Supported Languages

### Speech Recognition (Azure)
- English (en-US, en-GB)
- Spanish (es-ES)
- French (fr-FR)
- German (de-DE)
- Latvian (lv-LV)
- Lithuanian (lt-LT)
- Estonian (et-EE)
- And 20+ more languages

### Translation (DeepL)
- All major European languages
- Asian languages (Japanese, Chinese, Korean)
- And 30+ total languages

## 🔒 Security Notes

- Never commit `.env` files with API keys
- Use environment variables in production
- Restrict CORS origins in production
- Use HTTPS for production deployments

## 📝 License

This project is part of a hackathon submission. All rights reserved.

## 🤝 Contributing

This is a feature demonstration for a hackathon. For questions or issues, please open an issue on GitHub.

## 🙏 Acknowledgments

- Azure Speech Services for speech recognition
- DeepL for translation services
- Flask and Flask-SocketIO communities

