"""TTS generation for MemoCast episodes."""
import subprocess
from pathlib import Path
from backend.config import settings


async def generate_audio(text: str, output_path: str) -> str | None:
    """Generate audio from text using available TTS engine.
    
    Tries: kokoro > piper > edge-tts > None (returns script only)
    """
    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Try kokoro
    try:
        result = subprocess.run(
            ["kokoro", "--text", text, "--output", output_path],
            capture_output=True, timeout=180,
        )
        if result.returncode == 0:
            return output_path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    # Try piper
    try:
        result = subprocess.run(
            ["piper", "--model", "en_US-lessac-medium", "--output_file", output_path],
            input=text.encode(),
            capture_output=True, timeout=180,
        )
        if result.returncode == 0:
            return output_path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    # Try edge-tts (Python package)
    try:
        import edge_tts
        import asyncio
        
        communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
        await communicate.save(output_path)
        return output_path
    except (ImportError, Exception):
        pass
    
    return None
