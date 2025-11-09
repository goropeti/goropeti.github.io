// Fire Salamander Population Density Visualization
// Using iNaturalist API data

const yearElement = document.getElementById('year');
if (yearElement) {
  yearElement.textContent = String(new Date().getFullYear());
}

// Configuration
// First, we'll search for the taxon ID, then use it
let FIRE_SALAMANDER_TAXON_ID = null;
const CURRENT_YEAR = new Date().getFullYear();
const START_YEAR = CURRENT_YEAR - 20;
const EUROPE_BOUNDS = {
  nelat: 72,  // North East Latitude
  nelng: 45,  // North East Longitude
  swlat: 35,  // South West Latitude
  swlng: -25  // South West Longitude
};

// Get taxon ID for Salamandra salamandra
async function getTaxonId() {
  if (FIRE_SALAMANDER_TAXON_ID) {
    return FIRE_SALAMANDER_TAXON_ID;
  }
  
  try {
    // Search for the taxon
    const url = new URL('https://api.inaturalist.org/v1/taxa');
    url.searchParams.append('q', 'Salamandra salamandra');
    url.searchParams.append('rank', 'species');
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      // Find the exact match
      const taxon = data.results.find(t => 
        t.name.toLowerCase() === 'salamandra salamandra' ||
        t.preferred_common_name?.toLowerCase().includes('fire salamander')
      ) || data.results[0];
      
      FIRE_SALAMANDER_TAXON_ID = taxon.id;
      return FIRE_SALAMANDER_TAXON_ID;
    }
    
    // Fallback to known ID
    FIRE_SALAMANDER_TAXON_ID = 27062;
    return FIRE_SALAMANDER_TAXON_ID;
  } catch (error) {
    console.warn('Could not fetch taxon ID, using fallback:', error);
    FIRE_SALAMANDER_TAXON_ID = 27062;
    return FIRE_SALAMANDER_TAXON_ID;
  }
}

// Global state
let currentYear = null;
let vegaView = null;

// Initialize year dropdown
function initializeYearDropdown() {
  const yearSelect = document.getElementById('yearSelect');
  yearSelect.innerHTML = '<option value="">Válasszon évet...</option>';
  
  for (let year = CURRENT_YEAR; year >= START_YEAR; year--) {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    yearSelect.appendChild(option);
  }
  
  // Set default to current year
  yearSelect.value = CURRENT_YEAR;
  currentYear = CURRENT_YEAR;
}

// Fetch observations from iNaturalist API
async function fetchObservations(year) {
  const loadingIndicator = document.getElementById('loadingIndicator');
  loadingIndicator.style.display = 'block';
  
  // Get taxon ID first
  const taxonId = await getTaxonId();
  
  const observations = [];
  let page = 1;
  const perPage = 200;
  let hasMore = true;
  let totalResults = 0;
  
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  
  try {
    while (hasMore && page <= 10) { // Limit to 10 pages (2000 observations max per year)
      const url = new URL('https://api.inaturalist.org/v1/observations');
      url.searchParams.append('taxon_id', taxonId);
      // Use bounding box parameters (iNaturalist API format)
      url.searchParams.append('nelat', EUROPE_BOUNDS.nelat.toString());
      url.searchParams.append('nelng', EUROPE_BOUNDS.nelng.toString());
      url.searchParams.append('swlat', EUROPE_BOUNDS.swlat.toString());
      url.searchParams.append('swlng', EUROPE_BOUNDS.swlng.toString());
      url.searchParams.append('d1', startDate);
      url.searchParams.append('d2', endDate);
      url.searchParams.append('per_page', perPage.toString());
      url.searchParams.append('page', page.toString());
      url.searchParams.append('geo', 'true');
      // Include all quality grades for more data points
      url.searchParams.append('quality_grade', 'research,needs_id,casual');
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      observations.push(...data.results);
      totalResults = data.total_results || observations.length;
      
      hasMore = data.results.length === perPage && page < 10;
      page++;
      
      // Add a small delay to avoid rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    
    loadingIndicator.style.display = 'none';
    
    // Process observations and extract coordinates
    const validObservations = observations
      .map(obs => {
        let lat, lng;
        
        // Try different coordinate formats from iNaturalist API
        if (obs.geojson && obs.geojson.coordinates) {
          // GeoJSON format: [lng, lat]
          [lng, lat] = obs.geojson.coordinates;
        } else if (obs.location) {
          // Location string format: "lat,lng"
          const coords = obs.location.split(',');
          if (coords.length === 2) {
            lat = parseFloat(coords[0]);
            lng = parseFloat(coords[1]);
          }
        } else if (obs.latitude && obs.longitude) {
          // Direct latitude/longitude fields
          lat = obs.latitude;
          lng = obs.longitude;
        }
        
        if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
          return { ...obs, _lat: lat, _lng: lng };
        }
        return null;
      })
      .filter(obs => {
        if (!obs) return false;
        // Filter to ensure coordinates are within Europe bounds
        return obs._lat >= EUROPE_BOUNDS.swlat && obs._lat <= EUROPE_BOUNDS.nelat &&
               obs._lng >= EUROPE_BOUNDS.swlng && obs._lng <= EUROPE_BOUNDS.nelng;
      });
    
    return validObservations;
  } catch (error) {
    console.error('Error fetching observations:', error);
    loadingIndicator.style.display = 'none';
    document.getElementById('info').textContent = `Hiba az adatok betöltése során: ${error.message}. Kérjük, ellenőrizze az internetkapcsolatát és próbálja újra.`;
    return [];
  }
}

// Process observations into density grid with smoothing
function createDensityGrid(observations, gridSize = 30) {
  // Create a finer grid for better heatmap visualization
  const grid = new Map();
  
  observations.forEach(obs => {
    // Use the processed coordinates
    const lat = obs._lat;
    const lng = obs._lng;
    
    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
      // Round to grid cells with finer resolution
      const gridLat = Math.round(lat * gridSize) / gridSize;
      const gridLng = Math.round(lng * gridSize) / gridSize;
      const key = `${gridLat},${gridLng}`;
      
      if (!grid.has(key)) {
        grid.set(key, { lat: gridLat, lng: gridLng, count: 0 });
      }
      grid.get(key).count++;
    }
  });
  
  // Convert to array and add density calculation
  const gridArray = Array.from(grid.values());
  
  // Calculate max for normalization
  const maxCount = gridArray.length > 0 ? Math.max(...gridArray.map(d => d.count)) : 1;
  
  // Add normalized density
  gridArray.forEach(d => {
    d.density = d.count / maxCount;
  });
  
  return gridArray;
}

// Create Vega-Lite specification for map visualization
function createMapSpec(data, year) {
  const styles = getComputedStyle(document.documentElement);
  const colorText = styles.getPropertyValue('--text').trim() || '#e6edf3';
  const colorMuted = styles.getPropertyValue('--muted').trim() || '#9aa7b4';
  const colorBorder = styles.getPropertyValue('--border').trim() || '#223042';
  const colorAccent = styles.getPropertyValue('--accent').trim() || '#4aa3ff';
  const colorAccent2 = styles.getPropertyValue('--accent-2').trim() || '#7ed957';
  const panelBg = styles.getPropertyValue('--panel').trim() || '#121821';
  
  if (data.length === 0) {
    return null;
  }
  
  // Get max count for normalization
  const maxCount = Math.max(...data.map(d => d.count));
  
  // Try to use a simple, reliable approach with error handling
  const baseMapLayer = {
    // Base map layer: World countries (projection centers on Europe)
    mark: {
      type: 'geoshape',
      fill: panelBg,
      stroke: colorBorder,
      strokeWidth: 0.8,
      strokeOpacity: 0.7,
      fillOpacity: 0.25
    },
    data: {
      url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
      format: {
        type: 'topojson',
        feature: 'countries'
      }
    }
  };
  
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    description: `Tűzszalamandra Populáció Sűrűség Európában - ${year}`,
    width: 900,
    height: 600,
    projection: {
      type: 'mercator',
      scale: 600,
      center: [10, 55],
      translate: [450, 300]
    },
    config: {
      background: 'transparent',
      view: { stroke: null },
      axis: {
        labelColor: colorText,
        titleColor: colorMuted,
        domainColor: colorBorder,
        tickColor: colorBorder,
        gridColor: colorBorder
      },
      legend: {
        labelColor: colorText,
        titleColor: colorMuted,
        gradientLength: 300,
        gradientThickness: 20
      }
    },
    layer: [
      baseMapLayer,
      {
        // Observation data layer: Heatmap using circles
        mark: {
          type: 'circle',
          opacity: 0.8,
          stroke: colorBorder,
          strokeWidth: 0.5,
          strokeOpacity: 0.5
        },
        data: {
          values: data.map(d => ({
            latitude: d.lat,
            longitude: d.lng,
            count: d.count,
            density: d.density
          }))
        },
    encoding: {
          longitude: { 
            field: 'longitude', 
            type: 'quantitative',
            scale: { domain: [EUROPE_BOUNDS.swlng, EUROPE_BOUNDS.nelng] }
          },
          latitude: { 
            field: 'latitude', 
            type: 'quantitative',
            scale: { domain: [EUROPE_BOUNDS.swlat, EUROPE_BOUNDS.nelat] }
          },
          size: {
            field: 'count',
            type: 'quantitative',
            scale: { 
              type: 'sqrt',
              range: [25, 180],
              domain: [1, maxCount]
            },
            legend: { 
              title: 'Megfigyelések száma',
              format: 'd'
            }
          },
          color: {
            field: 'count',
            type: 'quantitative',
            scale: {
              scheme: 'viridis',
              domain: [0, maxCount],
              nice: true
          },
          legend: {
              title: 'Populáció sűrűség',
              format: 'd'
            }
          },
          tooltip: [
            { field: 'latitude', type: 'quantitative', format: '.3f', title: 'Szélesség' },
            { field: 'longitude', type: 'quantitative', format: '.3f', title: 'Hosszúság' },
            { field: 'count', type: 'quantitative', format: 'd', title: 'Megfigyelések' }
          ]
        }
      }
    ]
  };
}

// Create a simple map spec without base layer (fallback)
function createSimpleMapSpec(data, year) {
  const styles = getComputedStyle(document.documentElement);
  const colorText = styles.getPropertyValue('--text').trim() || '#e6edf3';
  const colorMuted = styles.getPropertyValue('--muted').trim() || '#9aa7b4';
  const colorBorder = styles.getPropertyValue('--border').trim() || '#223042';
  
  if (data.length === 0) {
    return null;
  }
  
  const maxCount = Math.max(...data.map(d => d.count));
  
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    description: `Tűzszalamandra Populáció Sűrűség Európában - ${year}`,
    width: 900,
    height: 600,
    projection: {
      type: 'mercator',
      scale: 600,
      center: [10, 55],
      translate: [450, 300]
    },
    config: {
      background: 'transparent',
      view: { stroke: null }
    },
    mark: {
      type: 'circle',
      opacity: 0.8,
      stroke: colorBorder,
      strokeWidth: 0.5
    },
    data: {
      values: data.map(d => ({
        latitude: d.lat,
        longitude: d.lng,
        count: d.count
      }))
    },
    encoding: {
      longitude: { 
        field: 'longitude', 
        type: 'quantitative',
        scale: { domain: [EUROPE_BOUNDS.swlng, EUROPE_BOUNDS.nelng] }
      },
      latitude: { 
        field: 'latitude', 
        type: 'quantitative',
        scale: { domain: [EUROPE_BOUNDS.swlat, EUROPE_BOUNDS.nelat] }
      },
      size: {
        field: 'count',
        type: 'quantitative',
        scale: { type: 'sqrt', range: [25, 180], domain: [1, maxCount] },
        legend: { title: 'Megfigyelések száma', format: 'd' }
      },
      color: {
        field: 'count',
        type: 'quantitative',
        scale: { scheme: 'viridis', domain: [0, maxCount] },
        legend: { title: 'Populáció sűrűség', format: 'd' }
      },
      tooltip: [
        { field: 'latitude', type: 'quantitative', format: '.3f', title: 'Szélesség' },
        { field: 'longitude', type: 'quantitative', format: '.3f', title: 'Hosszúság' },
        { field: 'count', type: 'quantitative', format: 'd', title: 'Megfigyelések' }
      ]
    }
  };
}

// Render the visualization
async function renderVisualization(year) {
  const chartEl = document.getElementById('chart');
  const infoEl = document.getElementById('info');
  
  if (!chartEl || !window.vegaEmbed) {
    console.error('Chart element or vegaEmbed not available');
    return;
  }
  
  // Clear previous visualization
  chartEl.innerHTML = '';
  infoEl.textContent = 'Megfigyelések betöltése...';
  
  // Fetch observations for the selected year
  const observations = await fetchObservations(year);
  
  if (observations.length === 0) {
    infoEl.textContent = `Nem találhatók megfigyelések ${year} évre.`;
    chartEl.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 40px;">Nincsenek adatok erre az évre.</p>';
    return;
  }
  
  // Create density grid
  const densityData = createDensityGrid(observations);
  
  // Try with base map first
  const spec = createMapSpec(densityData, year);
  
  if (!spec) {
    infoEl.textContent = `Nincsenek adatpontok vizualizálásra ${year} évre.`;
    chartEl.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 40px;">Nincsenek adatok erre az évre.</p>';
    return;
  }
  
  try {
    const result = await vegaEmbed('#chart', spec, {
      actions: false,
      renderer: 'svg',
      tooltip: { theme: 'dark' }
    });
    vegaView = result.view;
    const uniqueLocations = densityData.length;
    infoEl.textContent = `${observations.length} megfigyelés (${uniqueLocations} különböző helyszín) megjelenítése ${year} évre Európában. Adatok az iNaturalist-tól.`;
  } catch (error) {
    console.warn('Error with base map, trying without map layer:', error);
    // Fallback: render without base map
    const simpleSpec = createSimpleMapSpec(densityData, year);
    if (simpleSpec) {
      try {
        await vegaEmbed('#chart', simpleSpec, {
          actions: false,
          renderer: 'svg',
          tooltip: { theme: 'dark' }
        });
        infoEl.textContent = `${observations.length} megfigyelés megjelenítése ${year} évre (térkép háttér nem elérhető).`;
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        infoEl.textContent = `Hiba: ${fallbackError.message}`;
        chartEl.innerHTML = `<p style="text-align: center; color: #f88; padding: 40px;">Hiba a vizualizáció renderelése során.</p>`;
      }
    }
  }
}

// Handle year selection change
function setupYearSelector() {
  const yearSelect = document.getElementById('yearSelect');
  yearSelect.addEventListener('change', async (e) => {
    const selectedYear = parseInt(e.target.value);
    if (selectedYear && selectedYear !== currentYear) {
      currentYear = selectedYear;
      await renderVisualization(selectedYear);
    }
  });
}

// Initialize the application
async function init() {
  initializeYearDropdown();
  setupYearSelector();
  
  // Load initial data for current year
  if (currentYear) {
    await renderVisualization(currentYear);
  }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
