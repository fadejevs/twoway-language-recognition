import os
import logging
import deepl
import azure.cognitiveservices.speech as speechsdk

# Set up logger
logger = logging.getLogger(__name__)

class TranslationService:
    """Service for translating text using DeepL or Azure"""
    
    def __init__(self, config=None):
        """Initialize the translation service with the given config"""
        config = config or {}
        
        # Get API keys from config or environment
        self.azure_key = config.get('AZURE_SPEECH_KEY') or os.environ.get('AZURE_SPEECH_KEY')
        self.azure_region = config.get('AZURE_REGION') or os.environ.get('AZURE_REGION', 'westeurope')
        self.deepl_key = config.get('DEEPL_API_KEY') or os.environ.get('DEEPL_API_KEY')
        
        # Log configuration (without exposing full keys)
        logger.info(f"TranslationService init - AZURE_SPEECH_KEY: {'Set' if self.azure_key else 'Not set'}")
        logger.info(f"TranslationService init - AZURE_REGION: {self.azure_region}")
        logger.info(f"TranslationService init - DEEPL_API_KEY: {'Set' if self.deepl_key else 'Not set'}")
        
        # Initialize DeepL translator if API key is provided
        self.service_type = 'mock'  # Default to mock
        self.translator = None
        
        if self.deepl_key:
            try:
                self.translator = deepl.Translator(auth_key=self.deepl_key)
                logger.info(f"Using DeepL for translation with key: {self.deepl_key[:4]}...")
                self.service_type = 'deepl'
            except Exception as e:
                logger.error(f"Failed to initialize DeepL translator: {e}", exc_info=True)
                self.translator = None
        elif self.azure_key and self.azure_region:
            self.service_type = 'azure'
            logger.info("Using Azure for translation.")
        else:
            logger.warning("No translation service (DeepL or Azure) is fully configured.")
        
        logger.info(f"Finished initializing TranslationService. Service type: {self.service_type}")

    def _simplify_lang_code(self, lang_code):
        """Extracts the base 2-letter language code (e.g., 'en' from 'en-US')."""
        if lang_code and isinstance(lang_code, str):
            return lang_code.split('-')[0].upper() # Take first part and uppercase
        return None # Return None if input is invalid

    def _get_deepl_target_lang(self, lang_code):
        """
        Converts language code like 'en-US' to DeepL compatible format ('EN-US').
        Handles potential variations.
        """
        if not lang_code:
            return None
        # DeepL generally uses uppercase country codes and supports variants.
        # It accepts 'EN' but prefers 'EN-US'/'EN-GB' to avoid ambiguity/deprecation.
        parts = lang_code.strip().split('-')
        base_lang = parts[0].upper()
        if len(parts) == 2:
            country = parts[1].upper()
            # For English, DeepL specifically wants EN-GB or EN-US
            if base_lang == 'EN' and country in ['US', 'GB']:
                return f"{base_lang}-{country}" # Return EN-US or EN-GB
            # For Portuguese, PT-PT or PT-BR
            if base_lang == 'PT' and country in ['PT', 'BR']:
                 return f"{base_lang}-{country}" # Return PT-PT or PT-BR
            # For Chinese, ZH-CN (Simplified) is common
            if base_lang == 'ZH' and country == 'CN':
                 return "ZH" # DeepL uses ZH for Simplified Chinese

            # For other languages, DeepL might accept the full code or just the base.
            # Let's try passing the full uppercase code first. Check DeepL docs for specifics.
            # Example: 'lv-LV' -> 'LV-LV'. If this fails, try returning just base_lang.
            return f"{base_lang}-{country}"
        else:
            # Handle base codes like 'en', 'lv'. Convert 'en' -> 'EN-US' (default) or 'EN-GB'.
            if base_lang == 'EN':
                logger.warning(f"Received base 'en' target code. Defaulting to 'EN-US'. Use 'en-US' or 'en-GB' for clarity.")
                return "EN-US" # Or make this configurable?
            # For others, return the uppercase base code.
            return base_lang # e.g., 'lv' -> 'LV'

    def translate(self, text, source_lang, target_lang):
        """Translates text using the configured service."""
        if not text or not target_lang:
            logger.warning(f"Translation skipped: Text empty ({not text}), Target lang empty ({not target_lang})")
            return "" if text else "[No text to translate]" # Return empty if text was empty, else indicate missing target

        # --- Prepare language codes ---
        # Source language: DeepL often works best with auto-detect (None) or just the base code.
        deepl_source_lang = source_lang.split('-')[0].upper() if source_lang else None
        # Target language: Needs specific formatting.
        deepl_target_lang = self._get_deepl_target_lang(target_lang)

        if not deepl_target_lang:
             logger.error(f"Could not determine a valid DeepL target language code for input: {target_lang}")
             return f"[Invalid target language: {target_lang}]"
        # --- End Preparation ---

        logger.info(f"Translating text from {source_lang} ({deepl_source_lang or 'auto'}) to {target_lang} ({deepl_target_lang}) using {self.service_type} service")

        if self.service_type == 'deepl' and self.translator:
            try:
                # --- Use prepared DeepL codes ---
                result = self.translator.translate_text(
                    text,
                    source_lang=deepl_source_lang, # Pass 'LV' or None
                    target_lang=deepl_target_lang  # Pass 'EN-US', 'LV-LV', 'LV' etc.
                )
                # --- End Use ---
                translated_text = result.text
                detected_source = result.detected_source_lang # This is just the base code, e.g., 'LV'
                logger.info(f"DeepL translation successful. Detected source: {detected_source}. Result: {translated_text[:50]}...")
                return translated_text
            except deepl.exceptions.DeepLException as e:
                # Log the specific DeepL error
                logger.error(f"DeepL API error during translation from {deepl_source_lang or 'auto'} to {deepl_target_lang}: {e}")
                return f"[Translation error: {e}]"
            except Exception as e:
                logger.error(f"Unexpected error during DeepL translation: {e}", exc_info=True)
                return "[Unexpected translation error]"

        elif self.service_type == 'azure':
            # --- Azure Translation Logic ---
            # Ensure Azure logic also uses source_lang and target_lang correctly
            logger.warning("Azure translation logic needs implementation or review.")
            # Example structure (replace with actual Azure SDK calls)
            try:
                # azure_source = source_lang # Azure might need 'lv-LV'
                # azure_target = target_lang # Azure might need 'en-US'
                # translated_text = call_azure_translation(text, source=azure_source, target=azure_target)
                # logger.info("Azure translation successful.")
                # return translated_text
                return "[Azure translation not implemented]" # Placeholder
            except Exception as e:
                logger.error(f"Error during Azure translation: {e}", exc_info=True)
                return "[Azure translation error]"
            # --- End Azure ---

        else:
            logger.warning("No translation service configured or available.")
            return "[Translation service not available]"

    def translate_text(self, text, target_language, source_language=None):
        """
        Translate text to the target language.
        
        Args:
            text (str): Text to translate
            target_language (str): Target language code (e.g., 'en-US', 'lv-LV')
            source_language (str, optional): Source language code
            
        Returns:
            str: Translated text
        """
        if not text:
            return ""
        
        # Convert language codes to format expected by DeepL
        target_lang_code = self._convert_language_code(target_language)
        source_lang_code = self._convert_language_code(source_language) if source_language else None
        
        try:
            logger.info(f"Translating text from {source_language} ({source_lang_code}) to {target_language} ({target_lang_code}) using {self.service_type} service")
            
            if self.service_type == "deepl":
                # For DeepL, we need to simplify source language codes
                # DeepL only accepts basic language codes for source_lang (e.g., 'EN', not 'EN-US')
                if source_lang_code and '-' in source_lang_code:
                    source_lang_code = source_lang_code.split('-')[0]
                
                # Log the exact parameters being sent to DeepL
                logger.debug(f"DeepL API request parameters: target_lang={target_lang_code}, source_lang={source_lang_code}")
                
                # DeepL API call
                result = self.translator.translate_text(
                    text,
                    target_lang=target_lang_code,
                    source_lang=source_lang_code
                )
                return result.text
            else:
                # Azure translation or other service
                # ... existing code ...
                pass
                
        except Exception as e:
            error_msg = f"DeepL API error during translation from {source_lang_code} to {target_lang_code}: {str(e)}"
            logger.error(error_msg)
            return f"[Translation error: {str(e)}]"

    def _convert_language_code(self, language_code):
        """
        Convert language code to the format expected by the translation service.
        
        Args:
            language_code (str): Language code or name to convert
            
        Returns:
            str: Converted language code
        """
        if not language_code:
            return None
        
        if self.service_type == "deepl":
            # Map of language codes and names for DeepL
            deepl_lang_map = {
                # ISO codes
                'en': 'EN',
                'en-us': 'EN',  # Simplified to just 'EN' for DeepL
                'en-gb': 'EN',  # Simplified to just 'EN' for DeepL
                'de': 'DE',
                'fr': 'FR',
                'es': 'ES',
                'it': 'IT',
                'nl': 'NL',
                'pl': 'PL',
                'pt': 'PT',
                'pt-br': 'PT-BR',
                'pt-pt': 'PT-PT',
                'ru': 'RU',
                'ja': 'JA',
                'zh': 'ZH',
                'lv': 'LV',
                'lv-lv': 'LV',
                'lt': 'LT',
                'lt-lt': 'LT',
                'bg': 'BG',
                'cs': 'CS',
                'da': 'DA',
                'el': 'EL',
                'et': 'ET',
                'fi': 'FI',
                'hu': 'HU',
                'id': 'ID',
                'ko': 'KO',
                'nb': 'NB',
                'ro': 'RO',
                'sk': 'SK',
                'sl': 'SL',
                'sv': 'SV',
                'tr': 'TR',
                'uk': 'UK',
                
                # Language names
                'english': 'EN',
                'german': 'DE',
                'french': 'FR',
                'spanish': 'ES',
                'italian': 'IT',
                'dutch': 'NL',
                'polish': 'PL',
                'portuguese': 'PT',
                'russian': 'RU',
                'japanese': 'JA',
                'chinese': 'ZH',
                'latvian': 'LV',
                'lithuanian': 'LT',
                'bulgarian': 'BG',
                'czech': 'CS',
                'danish': 'DA',
                'greek': 'EL',
                'estonian': 'ET',
                'finnish': 'FI',
                'hungarian': 'HU',
                'indonesian': 'ID',
                'korean': 'KO',
                'norwegian': 'NB',
                'romanian': 'RO',
                'slovak': 'SK',
                'slovenian': 'SL',
                'swedish': 'SV',
                'turkish': 'TR',
                'ukrainian': 'UK'
            }
            
            # Normalize to lowercase for lookup
            normalized = language_code.lower()
            
            # Try the full code or name first
            if normalized in deepl_lang_map:
                return deepl_lang_map[normalized]
            
            # Try just the language part (before the hyphen)
            if '-' in normalized:
                lang_part = normalized.split('-')[0]
                if lang_part in deepl_lang_map:
                    return deepl_lang_map[lang_part]
            
            # Log warning for unmapped languages
            logger.warning(f"No mapping found for language code/name: {language_code}, using as is")
            return language_code
        
        # For other services, return as is or implement specific conversion
        return language_code
