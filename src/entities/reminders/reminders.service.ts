
import { db } from '../../lib/db/firebase';
import { jobsClient } from '../../lib/other/jobsClient';
import { ReminderData, QueuedJob, ProcessTodayRemindersResponse } from './reminders.dto';

async function processTodayReminders(uid: string): Promise<ProcessTodayRemindersResponse> {
  console.log("[ProcessTodayReminders] Iniciando procesamiento de reminders del día");

  // Obtener fecha de hoy al inicio y final del día
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  console.log("[ProcessTodayReminders] UID:", uid);

  // Ventana de tolerancia para reminders con hora específica (15 minutos antes y después)
  const currentTimeWithTolerance = new Date(now.getTime() - 15 * 60 * 1000); // 15 min antes
  const currentTimeEndTolerance = new Date(now.getTime() + 15 * 60 * 1000); // 15 min después

  console.log("[ProcessTodayReminders] Hora actual:", now.toLocaleString("es-AR"));
  console.log("[ProcessTodayReminders] Buscando reminders entre:", today, "y", todayEnd);

  // Obtener los reminders del día de hoy que NO estén procesados (primeros 20)
  const remindersSnapshot = await db
    .collection(`users/${uid}/reminders`)
    .where("eventDateTime", ">=", today)
    .where("eventDateTime", "<=", todayEnd)
    .orderBy("eventDateTime", "asc")
    .limit(20)
    .get();

  if (remindersSnapshot.empty) {
    console.log("[ProcessTodayReminders] No hay reminders para hoy");
    return {
      success: true,
      message: "No hay reminders para procesar hoy",
      remindersProcessed: 0,
    };
  }

  const allReminders = remindersSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as ReminderData[];

  console.log("[ProcessTodayReminders] Total reminders del día encontrados:", allReminders.length);

  // Filtrar reminders que NO estén en status 'sent' o 'processing'
  const unprocessedReminders = allReminders.filter((reminder) => {
    const status = reminder.status;
    const shouldSkip = status === 'sent' || status === 'processing';
    if (shouldSkip) {
      console.log(`[ProcessTodayReminders] ⏭️ Reminder ${reminder.id} omitido (status: ${status})`);
    }
    return !shouldSkip;
  });

  console.log("[ProcessTodayReminders] Reminders sin procesar:", unprocessedReminders.length);

  // Filtrar reminders según si tienen hora específica o no
  const reminders = unprocessedReminders.filter((reminder) => {
    const eventDateTime = reminder.eventDateTime.toDate();
    const hasSpecificTime = eventDateTime.getHours() !== 0 || eventDateTime.getMinutes() !== 0;

    if (hasSpecificTime) {
      // Reminder con hora específica: solo procesar si estamos dentro de la ventana de tolerancia
      const isWithinTimeWindow = eventDateTime >= currentTimeWithTolerance && eventDateTime <= currentTimeEndTolerance;
      console.log(
        `[ProcessTodayReminders] Reminder ${reminder.id} con hora específica (${eventDateTime.toLocaleTimeString("es-AR")}):`,
        isWithinTimeWindow ? "✅ Dentro de ventana (±15 min)" : "⏰ Fuera de ventana"
      );
      return isWithinTimeWindow;
    } else {
      // Reminder sin hora específica (00:00:00): procesar en cualquier momento del día
      console.log(`[ProcessTodayReminders] Reminder ${reminder.id} sin hora específica: ✅ Procesar ahora`);
      return true;
    }
  });

  console.log("[ProcessTodayReminders] Reminders a procesar después del filtrado:", reminders.length);

  // Obtener la URL base de la API
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiBaseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL no está configurado");
  }

  // Encolar cada reminder como un job
  const queuedJobs: QueuedJob[] = [];
  const errors: any[] = [];

  for (const reminder of reminders) {
    try {
      // Preparar la data para activate-agent
      const activateAgentData = {
        uid: reminder.userId,
        session: process.env.MULTIMAI_WS_SESSION,
        userPhone: reminder.customer?.phone,
        userName: reminder.customer?.name,
        assistantMessage: `Recordatorio: ${reminder.toRemember}`,
        reminderId: reminder.id,
      };

      // Verificar que todos los campos requeridos estén presentes
      if (!activateAgentData.uid || !activateAgentData.session || !activateAgentData.userPhone || !activateAgentData.userName) {
        console.error("[ProcessTodayReminders] Reminder con datos incompletos:", reminder.id);
        errors.push({
          reminderId: reminder.id,
          error: "Datos incompletos en el reminder",
        });
        continue;
      }

      // Encolar el job en el microservicio
      const jobPayload = {
        path: `${apiBaseUrl}/ws/activate-agent`, // Updated path for v2
        data: activateAgentData,
      };

      console.log("[ProcessTodayReminders] Encolando job para reminder:", reminder.id);
      console.log("[ProcessTodayReminders] Job payload:", JSON.stringify(jobPayload, null, 2));

      const response = await jobsClient.post("/enqueue", jobPayload);

      // Marcar el reminder como 'processing' en Firebase
      await db.collection(`users/${uid}/reminders`).doc(reminder.id).update({
        status: 'processing',
        processingStartedAt: new Date(),
      });

      console.log("[ProcessTodayReminders] 🔄 Reminder marcado como 'processing':", reminder.id);

      queuedJobs.push({
        reminderId: reminder.id,
        jobId: response.data?.jobId || "unknown",
        customerPhone: reminder.customer?.phone,
        customerName: reminder.customer?.name,
        toRemember: reminder.toRemember,
      });

      console.log("[ProcessTodayReminders] ✅ Job encolado exitosamente para reminder:", reminder.id);
    } catch (error: any) {
      console.error("[ProcessTodayReminders] Error encolando reminder:", reminder.id, error.message);
      errors.push({
        reminderId: reminder.id,
        error: error.message,
      });
    }
  }

  console.log("[ProcessTodayReminders] ✅ Procesamiento completado");
  console.log("[ProcessTodayReminders] Jobs encolados:", queuedJobs.length);
  console.log("[ProcessTodayReminders] Errores:", errors.length);

  return {
    success: true,
    message: "Reminders procesados exitosamente",
    remindersProcessed: queuedJobs.length,
    totalReminders: reminders.length,
    queuedJobs,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export default {
  processTodayReminders,
};
