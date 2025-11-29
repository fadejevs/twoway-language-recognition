"""
WebSocket handlers for two-way language recognition
Handles real-time speech recognition and translation
"""
import logging
import base64
import tempfile
import os
from flask import request, current_app
from flask_socketio import emit, join_room

logger = logging.getLogger(__name__)

# Track active real-time recognition sessions
active_realtime_sessions = {}

def register_websocket_handlers(socketio_instance, app):
    """Register all WebSocket event handlers"""
    
    @socketio_instance.on('connect')
    def on_connect():
        logger.info(f"Client connected: {request.sid}")
        emit('connection_success', {'message': 'Connected successfully'})
    
    @socketio_instance.on('disconnect')
    def on_disconnect():
        logger.info(f"Client disconnected: {request.sid}")
        # Clean up real-time session
        if request.sid in active_realtime_sessions:
            try:
                session = active_realtime_sessions[request.sid]
                session['recognizer'].stop_continuous_recognition_async()
                del active_realtime_sessions[request.sid]
                logger.info(f"[{request.sid}] Cleaned up real-time session on disconnect")
            except Exception as e:
                logger.error(f"[{request.sid}] Error cleaning up real-time session: {e}", exc_info=True)
    
    @socketio_instance.on('join_room')
    def handle_join_room(data):
        """Handle a client joining a room"""
        room = data.get('room')
        if not room:
            logger.warning(f"[{request.sid}] Client attempted to join without specifying a room.")
            return
        join_room(room)
        logger.info(f"[{request.sid}] Joined room: {room}")
        emit('room_joined', {'room': room})
    
    @socketio_instance.on('audio_chunk')
    def handle_audio_chunk(data):
        """Handle receiving an audio chunk from a client"""
        sid = request.sid
        room_id = data.get('room_id')
        audio_chunk_b64 = data.get('audio')
        audio_chunk_bytes = base64.b64decode(audio_chunk_b64) if audio_chunk_b64 else None
        source_language = data.get('language')
        target_languages = data.get('target_languages', [])
        
        if not all([room_id, audio_chunk_bytes, source_language]):
            logger.warning(f"[{sid}] Incomplete audio chunk data")
            emit('translation_error', {'message': 'Incomplete audio data received.', 'room_id': room_id})
            return
        
        logger.info(f"[{sid}] Received audio chunk for room '{room_id}', lang: {source_language}, targets: {target_languages}")
        
        try:
            speech_service = current_app.speech_service
            translation_service = current_app.translation_service
            
            if not speech_service or not translation_service:
                logger.error(f"[{sid}] Services not available.")
                emit('error', {'message': 'Backend services not available.'})
                return
            
            # Save audio bytes to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_audio_file:
                temp_audio_file.write(audio_chunk_bytes)
                temp_audio_path = temp_audio_file.name
            
            try:
                recognized_text = speech_service.recognize_speech_from_file(temp_audio_path, language=source_language)
            finally:
                os.remove(temp_audio_path)
            
            if not recognized_text:
                logger.info(f"[{sid}] No speech recognized from chunk")
                return
            
            logger.info(f"[{sid}] Recognized: '{recognized_text}'")
            
            # Translate to target languages
            translations = {}
            if target_languages:
                for target_lang in target_languages:
                    try:
                        translated = translation_service.translate(recognized_text, target_lang, source_language)
                        if translated:
                            translations[target_lang] = translated
                            logger.info(f"[{sid}] Translated to {target_lang}: '{translated[:30]}...'")
                            
                            result_data = {
                                'original': recognized_text,
                                'translations': {target_lang: translated},
                                'source_language': source_language,
                                'target_language': target_lang,
                                'room_id': room_id,
                                'is_manual': False,
                                'is_final': False
                            }
                            socketio_instance.emit('translation_result', result_data, room=room_id)
                    except Exception as e:
                        logger.error(f"[{sid}] Error translating to {target_lang}: {e}", exc_info=True)
            else:
                # No target languages, just emit original
                result_data = {
                    'original': recognized_text,
                    'translations': {},
                    'source_language': source_language,
                    'room_id': room_id,
                    'is_manual': False,
                    'is_final': False
                }
                socketio_instance.emit('translation_result', result_data, room=room_id)
        
        except Exception as e:
            logger.error(f"[{sid}] Audio chunk error: {e}", exc_info=True)
            emit('error', {'message': f'Audio chunk processing error: {str(e)}'})
    
    @socketio_instance.on('start_realtime_recognition')
    def on_start_realtime_recognition(data):
        """Initialize a real-time recognition session"""
        sid = request.sid
        room_id = data.get('room_id')
        language = data.get('language', 'en-US')
        target_languages = data.get('target_languages', [])
        
        logger.info(f"[{sid}] Starting real-time recognition for room '{room_id}' in language '{language}'")
        
        if not room_id:
            emit('error', {'message': 'Room ID is required for real-time recognition'})
            return
        
        speech_service = current_app.speech_service
        
        # Create a speech recognizer for this session
        recognizer_data = speech_service.create_recognizer(language)
        if not recognizer_data:
            emit('error', {'message': 'Failed to create speech recognizer'})
            return
        
        # Store session data
        active_realtime_sessions[sid] = {
            'room_id': room_id,
            'language': language,
            'target_languages': target_languages,
            'recognizer': recognizer_data['recognizer'],
            'audio_stream': recognizer_data['audio_stream'],
            'partial_result': '',
            'last_final_result': ''
        }
        
        # Set up event handlers
        recognizer = recognizer_data['recognizer']
        recognizer.recognizing.connect(lambda evt: handle_recognizing(evt, sid))
        recognizer.recognized.connect(lambda evt: handle_recognized(evt, sid))
        
        # Start continuous recognition
        recognizer.start_continuous_recognition_async()
        
        emit('realtime_recognition_started', {
            'message': 'Real-time recognition started',
            'room_id': room_id
        })
    
    def handle_recognizing(evt, sid):
        """Handle intermediate recognition results"""
        if sid not in active_realtime_sessions:
            return
        
        session = active_realtime_sessions[sid]
        room_id = session['room_id']
        partial_text = evt.result.text
        
        if not partial_text:
            return
        
        session['partial_result'] = partial_text
        
        socketio_instance.emit('realtime_transcription', {
            'text': partial_text,
            'is_final': False,
            'source_language': session['language'],
            'room_id': room_id
        }, room=room_id)
    
    def handle_recognized(evt, sid):
        """Handle final recognition results"""
        if sid not in active_realtime_sessions:
            return
        
        session = active_realtime_sessions[sid]
        room_id = session['room_id']
        final_text = evt.result.text
        
        if not final_text or final_text == session['last_final_result']:
            return
        
        session['last_final_result'] = final_text
        
        # Emit final transcription
        socketio_instance.emit('realtime_transcription', {
            'text': final_text,
            'is_final': True,
            'source_language': session['language'],
            'room_id': room_id
        }, room=room_id)
        
        # Process translations
        process_realtime_translation(sid, final_text)
    
    def process_realtime_translation(sid, text):
        """Translate the recognized text in real-time"""
        if sid not in active_realtime_sessions:
            return
        
        session = active_realtime_sessions[sid]
        room_id = session['room_id']
        source_language = session['language']
        target_languages = session['target_languages']
        
        translation_service = current_app.translation_service
        
        translations = {}
        for target_lang in target_languages:
            try:
                translated = translation_service.translate_text(
                    text, 
                    target_lang, 
                    source_language
                )
                
                if translated:
                    translations[target_lang] = translated
                    logger.info(f"[{sid}] Translated to {target_lang}: '{translated[:30]}...'")
            except Exception as e:
                logger.error(f"[{sid}] Error translating to {target_lang}: {e}", exc_info=True)
                translations[target_lang] = f"[Translation error: {str(e)}]"
        
        # Emit translation results
        socketio_instance.emit('realtime_translation', {
            'original': text,
            'translations': translations,
            'source_language': source_language,
            'room_id': room_id
        }, room=room_id)
    
    @socketio_instance.on('realtime_audio_chunk')
    def on_realtime_audio_chunk(data):
        """Process real-time audio chunks"""
        sid = request.sid
        room_id = data.get('room_id')
        audio_data = data.get('audio_data')
        
        if sid not in active_realtime_sessions:
            logger.warning(f"[{sid}] Received audio chunk but no active real-time session")
            return
        
        session = active_realtime_sessions[sid]
        
        if not audio_data:
            logger.warning(f"[{sid}] Received empty audio chunk")
            return
        
        try:
            audio_bytes = base64.b64decode(audio_data)
            session['audio_stream'].write(audio_bytes)
        except Exception as e:
            logger.error(f"[{sid}] Error processing real-time audio chunk: {e}", exc_info=True)
            emit('error', {'message': f'Error processing audio: {str(e)}'})
    
    @socketio_instance.on('stop_realtime_recognition')
    def on_stop_realtime_recognition(data):
        """Stop real-time recognition"""
        sid = request.sid
        
        if sid not in active_realtime_sessions:
            return
        
        session = active_realtime_sessions[sid]
        room_id = session['room_id']
        
        try:
            session['recognizer'].stop_continuous_recognition_async()
            del active_realtime_sessions[sid]
            
            logger.info(f"[{sid}] Stopped real-time recognition for room '{room_id}'")
            
            emit('realtime_recognition_stopped', {
                'message': 'Real-time recognition stopped',
                'room_id': room_id
            })
        except Exception as e:
            logger.error(f"[{sid}] Error stopping real-time recognition: {e}", exc_info=True)
            emit('error', {'message': f'Error stopping recognition: {str(e)}'})

