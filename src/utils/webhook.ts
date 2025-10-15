import sheet from "./sheets";

export const processWebhookMessage = async (message: string, userPhone: string) => {
  let messageToSend = message;
  let webhook = null;
  let response = null;
  // Check if message is a command (starts with "/")
  if (message.startsWith('/')) {
    // Extract command and rest of message
    const parts = message.split(' ');
    const command = parts[0]; // e.g., "/generar-respuesta"
    messageToSend = parts.slice(1).join(' '); // Rest of the message without the command

    console.log(`Command detected: ${command}, Message: ${messageToSend}`)

    // Get webhook for this phone number and command
    webhook = await sheet.getWebhookByCommand(userPhone, command)
    console.log({ webhook })

    if (!webhook) {
      console.log(`No webhook found for number ${userPhone} and command ${command}`)
      response = `No se encontró configuración para el comando ${command}`
    }
  } else {
    // Get the default webhook for this phone number
    webhook = await sheet.getWebhook(userPhone)
    console.log({ webhook })
    if (!webhook) {
      console.log(`No webhook found for number ${userPhone}`)
      response = 'Falta webhook para el numero de telefono'
    }
  }
  return {
    messageToSend,
    webhook,
    response,
  }
}