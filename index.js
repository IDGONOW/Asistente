const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());
app.use(session({ secret: 'asistente-bot', resave: false, saveUninitialized: true }));

// 🔐 Variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
let accessToken = null;

// 🌐 Ruta para iniciar autenticación con Google
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/calendar'
    ]
  });
  res.redirect(authUrl);
});

// 🔄 Ruta de retorno de Google OAuth
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("❌ Error: falta el parámetro 'code'.");
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    accessToken = tokens;
    oAuth2Client.setCredentials(tokens);
    res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
  } catch (error) {
    console.error("❌ Error al intercambiar token:", error.message);
    res.status(500).send("❌ Falló la autenticación. Revisa consola.");
  }
});

// 📩 Webhook de Telegram con logs
const processedMessages = new Set();

app.post('/webhook', async (req, res) => {
  console.log('📩 Webhook recibido:', JSON.stringify(req.body));

  try {
    const message = req.body.message;
    if (!message || !message.text) {
      console.log('⚠️ Mensaje vacío o sin texto');
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const messageId = message.message_id;
    const key = `${chatId}_${messageId}`;

    console.log('📨 Mensaje recibido:', text);

    if (processedMessages.has(key)) {
      console.log('🔁 Mensaje ya procesado:', key);
      return res.sendStatus(200);
    }
    processedMessages.add(key);

    if (!accessToken) {
      await sendMessage(chatId, '🔐 Primero necesitas autorizarme aquí:\n' + REDIRECT_URI.replace('/oauth2callback', '/auth'));
      return res.sendStatus(200);
    }

    oAuth2Client.setCredentials(accessToken);

    if (text.toLowerCase().startsWith('agregar tarea')) {
      const tarea = text.replace(/^agregar tarea[:\-]?\s*/i, '');
      await agregarTareaGoogle(tarea);
      await sendMessage(chatId, `✅ Tarea añadida:\n${tarea}`);
    } else if (text.toLowerCase().startsWith('crear reunión')) {
      const titulo = text.replace(/^crear reunión[:\-]?\s*/i, '');
      await crearEventoCalendar(titulo);
      await sendMessage(chatId, `📅 Reunión creada:\n${titulo}`);
    } else {
      await sendMessage(chatId, `👋 Hola, soy tu asistente personal.\n\nComandos:\n- Agregar tarea: enviar informe\n- Crear reunión: reunión equipo`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error en webhook:", error);
    res.sendStatus(500); // evita 502 Bad Gateway
  }
});

// ✅ Enviar mensaje a Telegram con log
async function sendMessage(chatId, text) {
  try {
    const res = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
    console.log('✅ Mensaje enviado a Telegram:', res.data);
  } catch (err) {
    console.error('❌ Error al enviar mensaje a Telegram:');
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

// ✅ Agregar tarea a Google Tasks
async function agregarTareaGoogle(titulo) {
  const tasks = google.tasks({ version: 'v1', auth: oAuth2Client });
  await tasks.tasks.insert({
    tasklist: '@default',
    requestBody: { title: titulo }
  });
  console.log('🗂️ Tarea creada:', titulo);
}

// ✅ Crear evento en Google Calendar
async function crearEventoCalendar(titulo) {
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  const ahora = new Date();
  const luego = new Date(ahora.getTime() + 60 * 60 * 1000);
  await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: titulo,
      start: { dateTime: ahora.toISOString() },
      end: { dateTime: luego.toISOString() }
    }
  });
  console.log('📅 Evento creado en Calendar:', titulo);
}

// 🟢 Ruta raíz
app.get('/', (req, res) => res.send('✅ Asistente activo'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Escuchando en puerto ${PORT}`));


