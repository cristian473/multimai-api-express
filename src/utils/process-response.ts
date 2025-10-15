import { MessageItem } from "@/entities/ws/ws.dto";

export function processResponse(response: string): MessageItem[] {
  const messages: MessageItem[] = [];
  // Split the response into chunks and send them sequentially
  const chunks = response.split(/\n\n+/);
  
  for (const chunk of chunks) {
      // Trim and clean each chunk
      let cleanedChunk = chunk.trim().replace(/【.*?】/g, ""); // Updated to remove the entire 【4:0†source】 part

      // First extract image links
      const imageLinks = cleanedChunk.match(/!\[(.*?)\]\((https:\/\/firebasestorage\.googleapis\.com\/[^\s)]+)\)/g);
      const imageData = imageLinks?.map(link => {
          const matches = link.match(/!\[(.*?)\]\((https:\/\/firebasestorage\.googleapis\.com\/[^\s)]+)\)/);
          return matches ? { description: matches[1], url: matches[2] } : null;
      }).filter(Boolean);

      // Then clean up the text and remove image links
      cleanedChunk = cleanedChunk.replace(/!\[.*?\]\(https:\/\/firebasestorage\.googleapis\.com\/[^\s)]+\)/g, '');

      // Replace [text](URL) format with just the URL for non-image links
      cleanedChunk = cleanedChunk.replace(/\[.*?\]\((https?:\/\/.*?)\)/g, '$1');

      // Replace ** with *
      cleanedChunk = cleanedChunk.replace(/\*\*/g, '`');

      // Si el chunk contiene ###, tomar el texto desde ### hasta \n y encerrarlo entre *
      const specialTextMatch = cleanedChunk.match(/###(.*?)\n/);
      if (specialTextMatch) {
          const specialText = specialTextMatch[1].trim();
          cleanedChunk = cleanedChunk.replace(specialTextMatch[0], `*${specialText}*\n`);
      }

      if (imageData && imageData.length > 0) {
          if(imageData.length > 1) {
              for (const data of imageData) {
                  let link = data.url;
                  if(String(link).endsWith('.')){
                      link = link.substring(0, link.length - 1);
                  }
                  
                  messages.push({
                      type: 'image',
                      payload: {
                          mimetype: 'image/jpeg', // Default mimetype for images
                          filename: data.description || 'image.jpg',
                          url: link,
                          caption: data.description || ''
                      }
                  });
              }

              if (cleanedChunk.trim()) {
                  messages.push({
                      type: 'text',
                      payload: {
                          content: cleanedChunk.trim()
                      }
                  });
              }
          } else {
              const data = imageData[0];
              let link = data.url;
              if(String(link).endsWith('.')){
                  link = link.substring(0, link.length - 1);
              }
              if (cleanedChunk.includes(`!${link}`)) {
                  cleanedChunk = cleanedChunk.replace(`!${link}`, '');
              } else {
                  cleanedChunk = cleanedChunk.replace(link, '');
              }
              
              messages.push({
                  type: 'image',
                  payload: {
                      mimetype: 'image/jpeg', // Default mimetype for images
                      filename: data.description || 'image.jpg',
                      url: link,
                      caption: data.description || ''
                  }
              });
          }
      } else {
          if (cleanedChunk.trim()) {
              messages.push({
                  type: 'text',
                  payload: {
                      content: cleanedChunk.trim()
                  }
              });
          }
      }
  }
  
  return messages;
}