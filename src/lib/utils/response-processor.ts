export interface MessageItem {
  type: "text" | "image";
  payload: {
    content?: string;
    mimetype?: string;
    filename?: string;
    url?: string;
    caption?: string;
  };
}

export function processResponse(response: string): MessageItem[] {
  // Remove text between @@ (e.g., @@id_property: alskdmalsmd@@)
  let cleanedResponse = response.replace(/@@[^@]*@@/g, "").trim();

  const messages: MessageItem[] = [];
  const chunks = cleanedResponse.split(/\n\n+/);

  for (const chunk of chunks) {
    let cleanedChunk = chunk.trim().replace(/【.*?】/g, "");

    // Extract image links
    // Updated regex to handle line breaks in alt text using [\s\S] instead of .
    const imageLinks = cleanedChunk.match(
      /!\[([\s\S]*?)\]\((https:\/\/firebasestorage\.googleapis\.com\/[^\s)]+)\)/g,
    );
    const imageData = imageLinks
      ?.map((link) => {
        const matches = link.match(
          /!\[([\s\S]*?)\]\((https:\/\/firebasestorage\.googleapis\.com\/[^\s)]+)\)/,
        );
        return matches ? { description: matches[1].trim(), url: matches[2] } : null;
      })
      .filter(
        (item): item is { description: string; url: string } => item !== null,
      );

    // Clean up text and remove image links
    // Updated regex to handle line breaks in alt text
    cleanedChunk = cleanedChunk.replace(
      /!\[[\s\S]*?\]\(https:\/\/firebasestorage\.googleapis\.com\/[^\s)]+\)/g,
      "",
    );

    // Replace [text](URL) with just URL for non-image links
    cleanedChunk = cleanedChunk.replace(/\[.*?\]\((https?:\/\/.*?)\)/g, "$1");

    // Replace ** with `
    cleanedChunk = cleanedChunk.replace(/\*\*/g, "`");

    // Handle ### special text
    const specialTextMatch = cleanedChunk.match(/###(.*?)\n/);
    if (specialTextMatch) {
      const specialText = specialTextMatch[1].trim();
      cleanedChunk = cleanedChunk.replace(
        specialTextMatch[0],
        `*${specialText}*\n`,
      );
    }

    if (imageData && imageData.length > 0) {
      if (imageData.length > 1) {
        for (const data of imageData) {
          let link = data.url;
          if (String(link).endsWith(".")) {
            link = link.substring(0, link.length - 1);
          }

          messages.push({
            type: "image",
            payload: {
              mimetype: "image/jpeg",
              filename: data.description || "image.jpg",
              url: link,
              caption: data.description || "",
            },
          });
        }

        if (cleanedChunk.trim()) {
          messages.push({
            type: "text",
            payload: {
              content: cleanedChunk.trim(),
            },
          });
        }
      } else {
        const data = imageData[0];
        let link = data.url;
        if (String(link).endsWith(".")) {
          link = link.substring(0, link.length - 1);
        }
        if (cleanedChunk.includes(`!${link}`)) {
          cleanedChunk = cleanedChunk.replace(`!${link}`, "");
        } else {
          cleanedChunk = cleanedChunk.replace(link, "");
        }

        messages.push({
          type: "image",
          payload: {
            mimetype: "image/jpeg",
            filename: data.description || "image.jpg",
            url: link,
            caption: data.description || "",
          },
        });
      }
    } else {
      if (cleanedChunk.trim()) {
        messages.push({
          type: "text",
          payload: {
            content: cleanedChunk.trim(),
          },
        });
      }
    }
  }

  return messages;
}


export function processSingleTextMessage(message: string) {
  return [
    {
      type: "text",
      payload: {
        content: message,
      },
    }
  ]
}