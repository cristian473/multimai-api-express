import axios from 'axios';
import db from './db';
import { SearchPropertiesParams } from './open-ai.tools';
import { Propiedad } from './db.types';

function modificarPorcentaje(num:number, porcentaje:number) {
  return num + (num * (porcentaje / 100));
}

function formatPrice(precio:any) {
  if(Array.isArray(precio) && typeof precio[0] === 'string' && precio[0].includes('-')){
    return precio[0].split('-').map(Number)
  }
  if(Array.isArray(precio) && precio.length > 1){
    return precio.map(Number)
  }
  if(typeof precio === 'string') {
    const transform = Number(precio)
    if(Number.isNaN(transform)){
      return 0
    }
    return transform
  }
  return 0
}

async function geocodificarDireccion(direccion:string) {
  const apiKey = process.env.GOOGLE_API_KEY; // Sustituye con tu clave de API de Google Maps
  let direccionConPais = direccion;

  // Verifica si la dirección ya incluye un país; si no, añade "Argentina"
  if (!direccion.toLowerCase().includes("argentina")) {
    direccionConPais = `${direccion}, Argentina`;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccionConPais)}&key=${apiKey}`;
  
  try {
    const response = await axios.get(url);
    if (response.data.status === "OK") {
      const { lat, lng } = response.data.results[0].geometry.location;
      console.log(`Coordenadas de ${direccion}:`, { lat, lng });
      return { lat, lng };
    } else {
      console.error("Error en la geocodificación:", response.data.status);
      return null;
    }
  } catch (error) {
    console.error("Error en la solicitud:", error);
    return null;
  }
}

const R = 6371; // Radio de la Tierra en kilómetros

// Función para calcular la distancia entre dos puntos usando la fórmula de Haversine
function calcularDistancia(lat1:number, lon1:number, lat2:number, lon2:number) {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Función para ordenar y marcar las ubicaciones
function ordenarYMarcarUbicaciones(array:any[], ubicacionReferencia:{lat:number, lng: number}) {
  return array
    .filter(item => item.coordenadas)
    .map(item => {
      const distancia = calcularDistancia(
        ubicacionReferencia.lat,
        ubicacionReferencia.lng,
        item.coordenadas.lat,
        item.coordenadas.lng
      );
      return { ...item, distancia, lejano: distancia > 10 }; // Agrega la distancia y la marca 'lejano'
    })
    .sort((a, b) => a.distancia - b.distancia)
    .filter((item) => !item.lejano); // Ordenar por distancia ascendente
}



function buscarPorPrecio(array:Propiedad[], precio:any, variacion = -10) {
  const [minPrecio, maxPrecio] = Array.isArray(precio) ? precio : [modificarPorcentaje(precio, variacion), modificarPorcentaje(precio, Math.abs(variacion))];
  console.log({minPrecio, maxPrecio})
  return array.filter(item => item.precio >= minPrecio && item.precio <= maxPrecio);
}

function buscarPorAmbientes(array:Propiedad[], ambientes:number) {
  return array.filter(item => Math.abs(Number(item.dormitorios ?? 1) - ambientes) <= 1);
}

export async function queryProperties(uid:string, criterios: SearchPropertiesParams) {
  const properties = await db.getProperties(uid);
  let result = properties
  console.log(properties)
  console.log({criterios})
  let strongResult:Propiedad[] = []
  let additionalText = ''

  if(criterios.id) {
    result = properties.filter((p) => String(p.id_propiedad) === criterios.id)
    return {result, additionalText}
  }

  if(criterios.precio) {
    criterios.precio = formatPrice(criterios.precio) as any
  }

  if(criterios.ubicacion) {
    const queryLocation = await geocodificarDireccion(criterios.ubicacion)
    console.log({queryLocation})
    if(queryLocation) {
      result = ordenarYMarcarUbicaciones(properties, queryLocation)
    }
  }

  if(criterios.tipo_operacion)  {
    result = result.filter(item => 
      criterios.tipo_operacion === 'Compra' 
      ? item.tipo_operacion === 'Venta'
      : item.tipo_operacion === criterios.tipo_operacion
    ) 
  }
  strongResult = [...result]
  
  if(criterios.tipo_propiedad) {
    result = result.filter(item => item.tipo_propiedad === criterios.tipo_propiedad)
  }

  if (criterios.precio) {
    result = result.filter(item => buscarPorPrecio([item], criterios.precio).length > 0);
  }
  
  if (criterios.ambientes) {
    result = result.filter(item => buscarPorAmbientes([item], Number(criterios.ambientes ?? 1)).length > 0);
  }


  if(result.length === 0 || result.every((item:any) => item.lejano === true)) {
    for (let index = 0; index < 4; index++) {
      if(result.length > 2) break;

      if(criterios.tipo_propiedad) {
        result = strongResult.filter(item => item.tipo_propiedad === criterios.tipo_propiedad)
      }

      if(result.length === 0) {
        result = strongResult.filter(item => 
          criterios.tipo_propiedad === 'Terreno'
            ? item.tipo_propiedad === 'Terreno'
            : item.tipo_propiedad !== 'Terreno'
          )
        additionalText = 'No encontré ninguna propiedad que coincida con los criterios, pero encontré otras propiedades que podrían interesarte:'
      }

      // if (criterios.precio) {
      //   const variacion = -15*(index+1)
      //   const precioToFilter = 
      //     Array.isArray(criterios.precio) 
      //     ? [modificarPorcentaje(Number(criterios.precio[0]), variacion), modificarPorcentaje(Number(criterios.precio[1]), Math.abs(variacion)) ] 
      //     : criterios.precio

      //   result = result.filter(item => buscarPorPrecio([item], precioToFilter, -15*(index+1)).length > 0);
      // }
      console.log('propiedades precio: ', result.length)

      
      if (criterios.ambientes) {
        result = result.filter(item => buscarPorAmbientes([item], criterios.ambientes as number).length > 0);
      }
      console.log('propiedades ambientes: ', result.length)

    }
  }
  console.log('propiedades encontradas: ', result.length)

  return {result, additionalText};
}