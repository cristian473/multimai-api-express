# Usar la imagen oficial de Node.js
FROM node:20-alpine

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar los archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install --legacy-peer-deps

# Copiar el código fuente
COPY . .

# Construir la aplicación
RUN npm run build

# Exponer el puerto
EXPOSE 80

# Comando para ejecutar la aplicación
CMD ["npm", "start"] 