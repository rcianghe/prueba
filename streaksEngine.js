/**
 * streaksEngine.js
 * Motor de Rachas y Tendencias — Escalerilla por Series 2026
 * CTQ (Club de Tenis Estadio Quilicura)
 *
 * Escrito contra el schema REAL de DATA en index.html:
 *
 *   DATA.results[i] = {
 *     fecha: "11-04-2026",          // DD-MM-YYYY (string)
 *     ganador: "Humberto Varas",
 *     perdedor: "Hector Varela",
 *     score: "1-6 1-6",             // o "W.O."
 *     serie: "A" | "B" | "C"
 *   }
 *
 *   DATA.players[i] = {
 *     id, nombre, serie, pts, pj, pg, pp, trend, retirado (bool)
 *   }
 *
 * Reusa parseFechaDDMMYYYY() ya definida en index.html (linea 446).
 * Si este archivo se carga standalone, incluye un fallback abajo.
 */

if (typeof parseFechaDDMMYYYY === 'undefined') {
  var parseFechaDDMMYYYY = function (f) {
    var p = f.split('-');
    return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0])).getTime();
  };
}

/**
 * Ordena cronologicamente los resultados, excluyendo partidos donde
 * cualquiera de los dos jugadores este marcado como retirado.
 */
function partidosValidosOrdenados(results, players) {
  var retiradoSet = {};
  players.forEach(function (p) {
    if (p.retirado) retiradoSet[p.nombre] = true;
  });

  return results
    .filter(function (r) {
      return r.ganador && r.perdedor &&
        !retiradoSet[r.ganador] && !retiradoSet[r.perdedor];
    })
    .slice()
    .sort(function (a, b) {
      return parseFechaDDMMYYYY(a.fecha) - parseFechaDDMMYYYY(b.fecha);
    });
}

/**
 * Historial cronologico por jugador: [{resultado:'W'/'L', rival, fecha, serie, wo}]
 */
function construirHistorialPorJugador(results, players) {
  var historial = {};
  var ordenados = partidosValidosOrdenados(results, players);

  ordenados.forEach(function (r) {
    var wo = r.score === 'W.O.';

    if (!historial[r.ganador]) historial[r.ganador] = [];
    if (!historial[r.perdedor]) historial[r.perdedor] = [];

    historial[r.ganador].push({ resultado: 'W', rival: r.perdedor, fecha: r.fecha, serie: r.serie, wo: wo });
    historial[r.perdedor].push({ resultado: 'L', rival: r.ganador, fecha: r.fecha, serie: r.serie, wo: wo });
  });

  return historial;
}

/** Racha actual: {tipo:'W'|'L'|null, cantidad:n} contando desde el partido mas reciente hacia atras. */
function calcularRachaActual(historialJugador) {
  if (!historialJugador || historialJugador.length === 0) return { tipo: null, cantidad: 0 };
  var ultimos = historialJugador.slice().reverse();
  var tipo = ultimos[0].resultado;
  var cantidad = 0;
  for (var i = 0; i < ultimos.length; i++) {
    if (ultimos[i].resultado === tipo) cantidad++;
    else break;
  }
  return { tipo: tipo, cantidad: cantidad };
}

/** Ultimos N resultados en orden cronologico, ej: ['W','W','L','W','L'] */
function ultimosN(historialJugador, n) {
  if (!historialJugador) return [];
  return historialJugador.slice(-(n || 5)).map(function (p) { return p.resultado; });
}

/**
 * "Matagigantes": victorias contra rivales mejor posicionados.
 * Usa el ranking FINAL (por pts, dentro de la misma serie) como proxy
 * de posicion — no hay snapshot historico por partido todavia.
 * Cuando conectemos evolucionRanking.js se le puede pasar el snapshot
 * exacto a la fecha del partido en vez del final.
 *
 * @param {Object} historial - salida de construirHistorialPorJugador
 * @param {Object} rankingPorSerie - { nombre: posicionEnSuSerie } (1 = mejor)
 */
function calcularIndiceMatagigantes(historial, rankingPorSerie) {
  var resultado = {};

  Object.keys(historial).forEach(function (jugador) {
    var miRanking = rankingPorSerie[jugador];
    if (miRanking == null) return;

    var sorpresas = [];
    historial[jugador].forEach(function (partido) {
      if (partido.resultado !== 'W' || partido.wo) return;
      var rankingRival = rankingPorSerie[partido.rival];
      if (rankingRival == null) return;
      if (rankingRival < miRanking) {
        sorpresas.push({
          rival: partido.rival,
          diferencial: miRanking - rankingRival,
          fecha: partido.fecha,
          serie: partido.serie
        });
      }
    });

    if (sorpresas.length > 0) {
      resultado[jugador] = {
        victoriasSorpresa: sorpresas.length,
        diferencialTotal: sorpresas.reduce(function (s, v) { return s + v.diferencial; }, 0),
        detalle: sorpresas.sort(function (a, b) { return b.diferencial - a.diferencial; })
      };
    }
  });

  return resultado;
}

/** Top N jugadores "matagigantes" por diferencial acumulado. */
function topMatagigantes(indiceMatagigantes, n) {
  return Object.keys(indiceMatagigantes)
    .map(function (jugador) {
      var d = indiceMatagigantes[jugador];
      return { jugador: jugador, victoriasSorpresa: d.victoriasSorpresa, diferencialTotal: d.diferencialTotal, detalle: d.detalle };
    })
    .sort(function (a, b) { return b.diferencialTotal - a.diferencialTotal; })
    .slice(0, n || 5);
}

/**
 * Construye { nombre: posicionEnSuSerie } a partir de DATA.players
 * ordenando por pts descendente dentro de cada serie. Excluye retirados.
 */
function rankingPorSerieDesdeDATA(players) {
  var porSerie = { A: [], B: [], C: [] };
  players.forEach(function (p) {
    if (!p.retirado && porSerie[p.serie]) porSerie[p.serie].push(p);
  });
  var posiciones = {};
  ['A', 'B', 'C'].forEach(function (serie) {
    var ordenados = porSerie[serie].slice().sort(function (a, b) { return b.pts - a.pts; });
    ordenados.forEach(function (p, i) { posiciones[p.nombre] = i + 1; });
  });
  return posiciones;
}

/**
 * Paquete completo de tendencias para un jugador — pensado para
 * inyectar directo en la tarjeta de perfil (funcion showProfile en index.html).
 */
function tendenciasJugador(nombreJugador, results, players) {
  var historial = construirHistorialPorJugador(results, players);
  var h = historial[nombreJugador] || [];

  var totalPartidos = h.length;
  var victorias = h.filter(function (p) { return p.resultado === 'W'; }).length;
  var derrotas = totalPartidos - victorias;
  var pctVictorias = totalPartidos > 0 ? (victorias / totalPartidos) * 100 : 0;

  var racha = calcularRachaActual(h);
  var ultimos5 = ultimosN(h, 5);

  var rankingPorSerie = rankingPorSerieDesdeDATA(players);
  var indice = calcularIndiceMatagigantes(historial, rankingPorSerie);
  var matagigantes = indice[nombreJugador] || { victoriasSorpresa: 0, diferencialTotal: 0, detalle: [] };

  return {
    jugador: nombreJugador,
    totalPartidos: totalPartidos,
    victorias: victorias,
    derrotas: derrotas,
    pctVictorias: Math.round(pctVictorias * 10) / 10,
    rachaActual: racha,
    ultimosCinco: ultimos5,
    matagigantes: matagigantes
  };
}

/**
 * Tabla "Matagigantes de la Temporada" lista para renderizar (usa
 * ranking final por serie como proxy, ver nota arriba).
 */
function tablaMatagigantes(results, players, n) {
  var historial = construirHistorialPorJugador(results, players);
  var rankingPorSerie = rankingPorSerieDesdeDATA(players);
  var indice = calcularIndiceMatagigantes(historial, rankingPorSerie);
  return topMatagigantes(indice, n || 5);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    partidosValidosOrdenados: partidosValidosOrdenados,
    construirHistorialPorJugador: construirHistorialPorJugador,
    calcularRachaActual: calcularRachaActual,
    ultimosN: ultimosN,
    calcularIndiceMatagigantes: calcularIndiceMatagigantes,
    topMatagigantes: topMatagigantes,
    rankingPorSerieDesdeDATA: rankingPorSerieDesdeDATA,
    tendenciasJugador: tendenciasJugador,
    tablaMatagigantes: tablaMatagigantes
  };
}
