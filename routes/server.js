const express = require("express");
const cors = require("cors");
const { faker } = require("@faker-js/faker");

const app = express();
app.use(cors());

/* ---------------- INDIA CITY DATA ---------------- */

const indiaCities = [
  { state: "Telangana",      city: "Hyderabad",     latMin: 17.2,  latMax: 17.6,  lngMin: 78.2,  lngMax: 78.7  },
  { state: "Andhra Pradesh", city: "Vijayawada",    latMin: 16.4,  latMax: 16.6,  lngMin: 80.5,  lngMax: 80.7  },
  { state: "Andhra Pradesh", city: "Visakhapatnam", latMin: 17.65, latMax: 17.80, lngMin: 83.15, lngMax: 83.35 },
  { state: "Karnataka",      city: "Bengaluru",     latMin: 12.90, latMax: 13.10, lngMin: 77.50, lngMax: 77.70 },
  { state: "Tamil Nadu",     city: "Chennai",       latMin: 13.05, latMax: 13.15, lngMin: 80.15, lngMax: 80.30 },
  { state: "Maharashtra",    city: "Mumbai",        latMin: 19.05, latMax: 19.25, lngMin: 72.80, lngMax: 72.95 },
  { state: "Delhi",          city: "New Delhi",     latMin: 28.55, latMax: 28.75, lngMin: 77.10, lngMax: 77.30 },
];

/* ---------------- HELPERS ---------------- */

const randomInRange = (min, max) => Math.random() * (max - min) + min;
const toRad = (v) => (v * Math.PI) / 180;

const getDistance = (lat1, lon1, lat2, lon2) => {
  const R    = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/* ---------------- PROPERTY GENERATOR ---------------- */

const generateProperty = (id) => {
  const cityData   = faker.helpers.arrayElement(indiaCities);
  const lat        = randomInRange(cityData.latMin, cityData.latMax);
  const long       = randomInRange(cityData.lngMin, cityData.lngMax);
  const localAreas = [
    `${cityData.city} Central`,
    `${cityData.city} East`,
    `${cityData.city} West`,
    `${cityData.city} Railway Station`,
    `${cityData.city} Main Road`,
    `${cityData.city} Tech Zone`,
    `${cityData.city} Residential Area`,
  ];

  return {
    property_id:     id,
    property_images: [{ id, image: `https://picsum.photos/400/300?random=${id}`, uploaded_at: new Date().toISOString(), property: id }],
    category_name:   faker.helpers.arrayElement(["2BHK Apartment", "3BHK Apartment", "Villa", "Duplex House", "Plot"]),
    mobile_no:       "9" + faker.number.int({ min: 100000000, max: 999999999 }),
    type:            faker.helpers.arrayElement(["sell", "rent"]),
    Admin_status:    "Approved",
    property_name:   faker.helpers.arrayElement(["Sai Residency", "Sri Nilayam", "Green Valley", "Lakshmi Enclave", "Royal Heights"]) + " " + faker.number.int({ min: 1, max: 500 }),
    facing:          faker.helpers.arrayElement(["East", "West", "North", "South"]),
    roadwidth:       faker.number.int({ min: 20, max: 60 }),
    site_area:       faker.number.int({ min: 600, max: 3000 }),
    length:          faker.number.int({ min: 20, max: 60 }),
    width:           faker.number.int({ min: 20, max: 60 }),
    units:           "ft",
    buildup_area:    faker.number.int({ min: 800, max: 4000 }),
    posted_by:       faker.helpers.arrayElement(["Builder", "Owner"]),
    price:           faker.number.int({ min: 1000000, max: 50000000 }),
    location:        `${faker.helpers.arrayElement(localAreas)}, ${cityData.city}, ${cityData.state}, India`,
    city:            cityData.city,
    state:           cityData.state,
    lat:             lat.toFixed(6),
    long:            long.toFixed(6),
    nearby:          faker.helpers.arrayElement(["Hospital", "School", "Metro Station", "Shopping Mall"]),
    no_of_flores:    faker.number.int({ min: 1, max: 5 }),
    duplex_bedrooms: faker.number.int({ min: 1, max: 5 }),
    bathrooms_count: faker.number.int({ min: 1, max: 4 }),
    power_backup:    faker.helpers.arrayElement(["yes", "no"]),
    gated_security:  faker.helpers.arrayElement(["yes", "no"]),
    borewell:        faker.helpers.arrayElement(["Yes", "No"]),
    parking:         faker.number.int({ min: 0, max: 3 }).toString(),
    lift:            faker.helpers.arrayElement(["Yes", "No"]),
    status:          true,
    user_id:         6,
    category_id:     60,
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  };
};

/* ---------------- PRE-GENERATE 300 PROPERTIES ---------------- */
const ALL_PROPERTIES = Array.from({ length: 300 }, (_, i) => generateProperty(i + 1));

/*
 * BASE_PROPERTIES — one property per city.
 * These are ALWAYS included in every API response (backend merges them)
 * so the frontend never needs to track them — all cities stay visible
 * on the map regardless of zoom level, without any frontend logic.
 */
const BASE_PROPERTIES = (() => {
  const seen = new Set();
  const base = [];
  for (const p of ALL_PROPERTIES) {
    if (!seen.has(p.city)) {
      seen.add(p.city);
      base.push(p);
    }
    if (seen.size === indiaCities.length) break;
  }
  return base; // 7 properties — one per city
})();

/* ================================================================
   GET /api/properties

   CASE 1 — No lat/lng  →  Initial load
     Returns 20 properties guaranteed to cover all 7 cities
     (2-3 per city). Frontend just does: setProperties(json.data)

   CASE 2 — lat + lng + radius  →  Zoom / pan
     Backend does ALL the work:
       1. Filters by radius (viewport properties)
       2. Merges BASE_PROPERTIES (so all city dots stay on map)
       3. Deduplicates by property_id
     Frontend just does: setProperties(json.data)
     No merging, no filtering, no state management on frontend.

   Query params:
     lat    – map center latitude
     lng    – map center longitude
     radius – km  (frontend sends zoom-based radius)
     limit  – max viewport results (default 30)
================================================================ */

app.get("/api/properties", (req, res) => {
  const { lat, lng, radius, limit = 30 } = req.query;

  /* -------- CASE 1: INITIAL LOAD -------- */
  if (!lat || !lng) {
    // Group by city and pick 2-3 per city so all cities are represented
    const perCity = {};
    for (const p of ALL_PROPERTIES) {
      if (!perCity[p.city]) perCity[p.city] = [];
      perCity[p.city].push(p);
    }

    const selected = [];
    for (const city of Object.keys(perCity)) {
      const shuffled = perCity[city].sort(() => Math.random() - 0.5);
      selected.push(...shuffled.slice(0, 3)); // 3 per city × 7 cities = 21 max
    }

    const data = selected.sort(() => Math.random() - 0.5).slice(0, 20);

    return res.json({
      mode:  "initial",
      total: data.length,
      data,  // frontend: setProperties(json.data) — done
    });
  }

  /* -------- CASE 2: VIEWPORT FETCH -------- */
  const centerLat = parseFloat(lat);
  const centerLng = parseFloat(lng);
  const radiusKm  = parseFloat(radius || 50);
  const maxCount  = parseInt(limit);

  // Step 1 — filter & sort by distance (all done on backend)
  const viewportProps = ALL_PROPERTIES
    .map((p) => ({
      ...p,
      _dist: getDistance(centerLat, centerLng, parseFloat(p.lat), parseFloat(p.long)),
    }))
    .filter((p) => p._dist <= radiusKm)
    .sort((a, b) => a._dist - b._dist)
    .slice(0, maxCount)
    .map(({ _dist, ...p }) => p);

  // Step 2 — backend merges base properties so ALL cities stay visible
  const vpIds   = new Set(viewportProps.map((p) => p.property_id));
  const baseAdd = BASE_PROPERTIES.filter((p) => !vpIds.has(p.property_id));

  // Step 3 — send merged, deduplicated array to frontend
  // Frontend has zero logic to write — just render json.data
  const data = [...viewportProps, ...baseAdd];

  return res.json({
    mode:           "viewport",
    center:         { lat: centerLat, lng: centerLng },
    radius:         radiusKm,
    viewport_count: viewportProps.length,
    base_count:     baseAdd.length,
    total:          data.length,
    data,           // frontend: setProperties(json.data) — done
  });
});

/* ---------------- START SERVER ---------------- */
app.listen(5000, () => {
  console.log("🚀 Property API → http://localhost:5000");
  console.log("");
  console.log("  Initial load : GET /api/properties");
  console.log("  Zoom fetch   : GET /api/properties?lat=17.38&lng=78.48&radius=10&limit=30");
});