// index.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const chrono = require('chrono-node');
const { google } = require('googleapis');
const session = require('express-session');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json());
app.use(session({ secret: 'asistente-secreto', resave: false, saveUninitialized: true }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const CHAT_ID = process.env.CHAT_ID;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let userCredentials = null;

app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks']
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  userCredentials = tokens;
  res.send('✅ Autenticación exitosa. Puedes volver a Telegram.');
});

function sendTelegramMessage(chatId, text) {
  return axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
  });
}

async function addGoogleTask(taskText) {
  if (!userCredentials) return;
  oauth2Client.setCredentials(userCredentials);
  const tasks = google.tasks({ version: 'v1', auth: oauth2Client });
  await tasks.tasks.insert({
    tasklist: '@default',
    requestBody: { title: taskText },
  });
}

async function createGoogleCalendarEvent(summary, dateText) {
  if (!userCredentials) return;
  oauth2Client.setCredentials(userCredentials);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const now = moment();
  let parsedDate = chrono.parseDate(dateText);

  // Validar si parsedDate es valido
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return `❌ No entendí la fecha. Usa un formato como "3 de junio a las 11 am"`;
  }

  // Si la fecha interpretada es pasada, intentar usar el próximo año
  if (parsedDate < now.toDate()) {
    parsedDate = moment(parsedDate).add(1, 'year').toDate();
  }

  // Ajustar zona horaria
  const start = moment(parsedDate).tz('America/Lima').format();
  const end = moment(parsedDate).add(1, 'hour').tz('America/Lima').format();

  await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      start: { dateTime: start, timeZone: 'America/Lima' },
      end: { dateTime: end, timeZone: 'America/Lima' },
    },
  });
  return `📅 Reunión "${summary}" agendada para ${moment(start).format('LLLL')}`;
}

app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  console.log('📨 Mensaje recibido:', text);

  try {
    if (text.toLowerCase().startsWith('agregar tarea:')) {
      const taskText = text.replace(/agregar tarea:/i, '').trim();
      await addGoogleTask(taskText);
      await sendTelegramMessage(chatId, `✅ Tarea agregada: "${taskText}"`);
    } else if (text.toLowerCase().startsWith('crear reunion:')) {
      const parts = text.replace(/crear reunion:/i, '').trim().split(/(mañana|hoy|\d{1,2} (de )?[a-záéíóú]+|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/i);
      const summary = parts[0].trim();
      const dateText = text.replace(/crear reunion:/i, '').trim().replace(summary, '').trim();
      const result = await createGoogleCalendarEvent(summary, dateText);
      await sendTelegramMessage(chatId, result);
    } else {
      await sendTelegramMessage(chatId, '🤖 Comando no reconocido. Usa "Agregar tarea: ..." o "Crear reunion: ..."');
    }
  } catch (err) {
    console.error('❌ Error en webhook:', err);
    await sendTelegramMessage(chatId, '⚠️ Hubo un error al procesar tu solicitud.');
  }
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`🚀 Escuchando en puerto ${PORT}`);
});


