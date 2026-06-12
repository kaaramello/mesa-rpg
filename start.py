"""Script de inicialização com ngrok embutido."""
import os, sys

NGROK_TOKEN = "3F1S8VGgj3CIcUe7IehOJ3fOxGx_gfZnCUoFDmezNhaJSwMg"

os.environ['NGROK_TOKEN'] = NGROK_TOKEN

# Importa e inicia o app normalmente — app.py já contém a lógica do ngrok
exec(open(os.path.join(os.path.dirname(__file__), 'app.py')).read())
