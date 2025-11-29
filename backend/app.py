import logging
import os
from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO
from dotenv import load_dotenv

from services.speech_service import SpeechService
from services.translation_service import TranslationService
from routes.websocket import register_websocket_handlers

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')

# Enable CORS
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize SocketIO
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins="*")

# Initialize services
speech_service = SpeechService({
    'AZURE_SPEECH_KEY': os.environ.get('AZURE_SPEECH_KEY'),
    'AZURE_REGION': os.environ.get('AZURE_REGION', 'westeurope')
})

translation_service = TranslationService({
    'AZURE_SPEECH_KEY': os.environ.get('AZURE_SPEECH_KEY'),
    'AZURE_REGION': os.environ.get('AZURE_REGION', 'westeurope'),
    'DEEPL_API_KEY': os.environ.get('DEEPL_API_KEY')
})

# Attach services to app context
app.speech_service = speech_service
app.translation_service = translation_service

# Register WebSocket handlers
register_websocket_handlers(socketio, app)

@app.route('/')
def index():
    return {'message': 'Two-Way Language Recognition API', 'status': 'running'}

@app.route('/health')
def health():
    return {
        'status': 'healthy',
        'speech_service': 'configured' if speech_service.azure_key else 'not configured',
        'translation_service': translation_service.service_type
    }

if __name__ == '__main__':
    logger.info("Starting Two-Way Language Recognition server...")
    socketio.run(app, host='0.0.0.0', port=3000, debug=True)

