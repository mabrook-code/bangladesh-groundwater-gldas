/*
 * Groundwater Storage Dynamics in Bangladesh, 2024
 * ------------------------------------------------
 * Author     : Mabrook, Dept. of Urban & Regional Planning, KUET
 * Data       : NASA GLDAS-2.2 Catchment Land Surface Model (CLSM) with GRACE
 *              data assimilation, daily, 0.25° (NASA/GLDAS/V022/CLSM/G025/DA1D)
 *              Band GWS_tavg = groundwater storage (mm of water)
 * Boundaries : FAO GAUL 2015, Level 1 (simplified 500 m)
 * Period     : January – December 2024
 *
 * Steps:
 *   1. Load division boundaries for Bangladesh
 *   2. Load daily GLDAS groundwater storage for 2024
 *   3. Build monthly mean groundwater storage images
 *   4. Time series chart of monthly storage by division
 *   5. Annual mean and seasonal amplitude (max − min) by division
 *   6. Maps for January, May, September, and December on a common colour scale
 *   7. Export the division-by-month table (CSV) and the rasters (GeoTIFF)
 */


// ===================== 1. Division boundaries =====================
var divisions = ee.FeatureCollection('FAO/GAUL_SIMPLIFIED_500m/2015/level1')
    .filter(ee.Filter.eq('ADM0_NAME', 'Bangladesh'))
    .select(['ADM1_NAME']);

print('Divisions in the boundary dataset:', divisions.aggregate_array('ADM1_NAME'));

var region = divisions.geometry();
var exportRegion = region.bounds();
Map.centerObject(divisions, 7);

var SCALE = 27830;   // 0.25° GLDAS grid cell (~27.8 km)


// ===================== 2. GLDAS groundwater storage =====================
var START = ee.Date('2024-01-01');
var END   = ee.Date('2025-01-01');

var gwsDaily = ee.ImageCollection('NASA/GLDAS/V022/CLSM/G025/DA1D')
    .select('GWS_tavg')
    .filterDate(START, END);

print('Number of daily GLDAS images:', gwsDaily.size());


// ===================== 3. Monthly mean storage =====================
var nMonths = END.difference(START, 'month').round();

var monthly = ee.ImageCollection(ee.List.sequence(0, nMonths.subtract(1)).map(function (m) {
  var start = START.advance(ee.Number(m), 'month');
  var end = start.advance(1, 'month');
  var days = gwsDaily.filterDate(start, end);
  return days.mean().rename('GWS')
      .set('system:time_start', start.millis())
      .set('month', start.format('YYYY-MM'))
      .set('n_days', days.size());
}));

print('Days of data in each month:', monthly.aggregate_array('n_days'));


// ===================== 4. Time series by division =====================
var chart = ui.Chart.image.seriesByRegion({
  imageCollection: monthly,
  regions: divisions,
  reducer: ee.Reducer.mean(),
  band: 'GWS',
  scale: SCALE,
  xProperty: 'system:time_start',
  seriesProperty: 'ADM1_NAME'
}).setOptions({
  title: 'Monthly Mean Groundwater Storage by Division, Bangladesh (GLDAS-2.2), 2024',
  hAxis: {title: 'Month', format: 'MMM'},
  vAxis: {title: 'Groundwater storage (mm)'},
  lineWidth: 2,
  pointSize: 3
});
print(chart);


// ===================== 5. Annual mean and seasonal amplitude =====================
var annualMean = monthly.mean().rename('mean_mm');
var amplitude  = monthly.max().subtract(monthly.min()).rename('amplitude_mm');

var divisionSummary = annualMean.addBands(amplitude).reduceRegions({
  collection: divisions,
  reducer: ee.Reducer.mean(),
  scale: SCALE
});

print('Annual mean storage and seasonal amplitude by division (mm), largest swing first:',
      divisionSummary.sort('amplitude_mm', false)
                     .select(['ADM1_NAME', 'mean_mm', 'amplitude_mm'], null, false));


// ===================== 6. Seasonal maps on a common colour scale =====================
var MAP_MONTHS = ['2024-01', '2024-05', '2024-09', '2024-12'];

function monthImage(month) {
  return ee.Image(monthly.filter(ee.Filter.eq('month', month)).first());
}

// Use the 2nd–98th percentile across the whole year so all four maps share one legend
var low = monthly.min().reduceRegion({
  reducer: ee.Reducer.percentile([2]), geometry: region, scale: SCALE, maxPixels: 1e9
}).values().get(0);
var high = monthly.max().reduceRegion({
  reducer: ee.Reducer.percentile([98]), geometry: region, scale: SCALE, maxPixels: 1e9
}).values().get(0);

var storagePalette = ['8c510a', 'd8b365', 'f6e8c3', 'c7eae5', '5ab4ac', '01665e'];
var outline = ee.Image().byte().paint({featureCollection: divisions, color: 1, width: 1});

ee.Dictionary({low: low, high: high}).evaluate(function (range) {
  print('Common colour scale for the maps (mm), reuse in ArcGIS Pro:', range);
  var vis = {min: range.low, max: range.high, palette: storagePalette};
  MAP_MONTHS.forEach(function (m) {
    Map.addLayer(monthImage(m).clip(divisions), vis, 'Groundwater storage ' + m, m === '2024-09');
  });
  Map.addLayer(amplitude.clip(divisions),
               {min: 0, max: 400, palette: ['ffffcc', 'fd8d3c', 'bd0026']},
               'Seasonal amplitude (max − min, mm)', false);
  Map.addLayer(outline, {palette: '000000'}, 'Division boundaries');
});


// ===================== 7. Exports (run from the Tasks tab) =====================
// Division-by-month table: one row per division per month
var monthlyTable = ee.FeatureCollection(monthly.map(function (img) {
  var month = img.get('month');
  return img.reduceRegions({
    collection: divisions,
    reducer: ee.Reducer.mean().setOutputs(['GWS_mm']),
    scale: SCALE
  }).map(function (f) {
    return f.set('month', month).setGeometry(null);
  });
})).flatten();

Export.table.toDrive({
  collection: monthlyTable,
  description: 'gws_division_monthly_2024',
  folder: 'BD_GWS',
  fileFormat: 'CSV',
  selectors: ['ADM1_NAME', 'month', 'GWS_mm']
});

Export.table.toDrive({
  collection: divisionSummary,
  description: 'gws_division_summary_2024',
  folder: 'BD_GWS',
  fileFormat: 'CSV',
  selectors: ['ADM1_NAME', 'mean_mm', 'amplitude_mm']
});

function exportRaster(img, name) {
  Export.image.toDrive({
    image: img.clip(divisions).toFloat(),
    description: name,
    fileNamePrefix: name,
    folder: 'BD_GWS',
    region: exportRegion,
    scale: SCALE,
    crs: 'EPSG:4326',
    maxPixels: 1e9
  });
}

MAP_MONTHS.forEach(function (m) {
  exportRaster(monthImage(m), 'gws_' + m.replace('-', '_'));
});
exportRaster(amplitude, 'gws_amplitude_2024');