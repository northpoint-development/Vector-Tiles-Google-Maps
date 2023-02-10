/*
 *  Created by Jes�s Barrio on 04/2021
 */

// eslint-disable-next-line spaced-comment
/// <reference types="google.maps" />

import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import * as MERCATOR from '../lib/mercator/Mercator.js';
import {MVTLayer} from './MVTLayer.js';

/**
 * @typedef {import('@mapbox/vector-tile').VectorTileLayer} VectorTileLayer
 * @typedef {import('@mapbox/vector-tile').VectorTileFeature} VectorTileFeature
 * @typedef {import('./MVTFeature').FeatureTile} FeatureTile
 */

/**
 * @callback featureIdFn - A function that returns a unique id for a feature
 * @param {VectorTileFeature} feature
 * @return {string|number}
 *
 * @callback styleFn - A function that returns a style for a feature
 * @param {VectorTileFeature} feature
 * @return {StyleOptions}
 *
 * @callback drawFn - A function that returns a style for a feature
 * @param {TileContext} tileContext
 * @param {FeatureTile} tile
 * @param {StyleOptions} style
 * @return {void}
 *
 * @callback filterFn - A function that returns a style for a feature
 * @param {VectorTileFeature} feature
 * @param {TileContext} context
 * @return {boolean}
 */

/**
 * @typedef {Object} MVTSourceOptions
 * @property {string} [url] Url to Vector Tile Source
 * @property {number} [sourceMaxZoom] Source max zoom to enable over zoom
 * @property {boolean} [debug] Draw tiles lines and ids
 * @property {boolean} [cache=false] Load tiles in cache to avoid duplicated requests
 * @property {number} [tileSize=256] Tile size
 * @property {Array<String>} [visibleLayers] List of visible layers
 * @property {Array<String>} [clickableLayers] List of layers that are clickable
 * @property {Array<String>} [selectedFeatures] List of selected features
 * @property {featureIdFn} [getIDForLayerFeature] Function to get id for layer feature
 * @property {styleFn} [style] Styling function
 * @property {filterFn} [filter] Filter function
 * @property {drawFn} [customDraw] Custom draw function
*/

/**
 * @typedef {Object} TileContext
 * @property {string} id Tile id in format 'zoom:x:y'
 * @property {HTMLCanvasElement} canvas Canvas element for drawing tile
 * @property {number} zoom Zoom level this tile belongs to
 * @property {number} tileSize Tile size
 * @property {string} parentId Parent tile id in format 'zoom:x:y'
 * @property {VectorTile} [vectorTile]
 */

/**
 * @typedef {Object} StyleOptions
 * @property {string} fillStyle Fill color
 * @property {string} strokeStyle Stroke color
 * @property {number} lineWidth Stroke width
 * @property {number} radius Point radius
 * @property {StyleOptions} selected Selected style
 */

/**
 * Returns the default styling function
 * @param {VectorTileFeature} feature
 * @return {StyleOptions}
 */
const defaultStyleFn = function(feature) {
  return {
    1: { // Point
      fillStyle: 'rgba(49,79,79,1)',
      radius: 5,
      selected: {
        fillStyle: 'rgba(255,255,0,0.5)',
        radius: 6,
      },
    },
    2: { // LineString
      strokeStyle: 'rgba(136, 86, 167, 1)',
      lineWidth: 3,
      selected: {
        strokeStyle: 'rgba(255,25,0,0.5)',
        lineWidth: 4,
      },
    },
    3: { // Polygon
      fillStyle: 'rgba(188, 189, 220, 0.5)',
      strokeStyle: 'rgba(136, 86, 167, 1)',
      lineWidth: 1,
      selected: {
        fillStyle: 'rgba(255,140,0,0.3)',
        strokeStyle: 'rgba(255,140,0,1)',
        lineWidth: 2,
      },
    },
  }[feature.type] || {};
};

/**
 * @param {VectorTileFeature} feature
 * @return {string|number}
 */
const defaultFeatureIdFn = function(feature) {
  return feature?.properties?.id || feature?.properties?.Id || feature?.properties?.ID;
};

/**
 * @param {number} zoom
 * @param {number} x
 * @param {number} y
 * @return {string}
 */
const getTileString = (zoom, x, y) => [zoom, x, y].join(':');

/**
 * @param {string} id Tile id in format 'zoom:x:y'
 * @return {{zoom: number, x: number, y: number}}
 */
const getTileFromString = (id) => {
  try {
    const [zoom, x, y] = id.split(':');
    return {
      zoom: Number(zoom),
      x: Number(x),
      y: Number(y),
    };
  } catch (e) {
    console.error('Error parsing tile id', id);
    return {zoom: 0, x: 0, y: 0};
  }
};

/**
 * @param {string} tileId
 * @param {number} maxZoom
 * @return {string} Parent tile id
 */
const getParentId = (tileId, maxZoom) => {
  if (!maxZoom) return '';
  const tile = getTileFromString(tileId);
  if (!(tile.zoom > maxZoom)) return '';
  const zoomDistance = tile.zoom - maxZoom;
  const zoom = tile.zoom - zoomDistance;
  const x = tile.x >> zoomDistance;
  const y = tile.y >> zoomDistance;
  return getTileString(zoom, x, y);
};

/**
 * @param {Document} ownerDocument
 * @param {string} tileId
 * @param {number} tileSize
 * @return {HTMLCanvasElement}
 */
const createCanvas = (ownerDocument, tileId, tileSize) => {
  const canvas = ownerDocument.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  canvas.id = tileId;
  return canvas;
};

/**
 * MVTSource is a class to load and draw Vector Tiles from a source.
 * @class
 * @implements {google.maps.MapType}
 */
class MVTSource {
  /**
   * @param {google.maps.Map} map
   * @param {MVTSourceOptions} options
   */
  constructor(map, options = {}) {
    // Private properties
    /** @type {string} Url to Vector Tile Source */
    this._url = options.url || '';
    /** @type {number} Source max zoom to enable over zoom */
    this._sourceMaxZoom = options.sourceMaxZoom ?? null;
    /** @type {boolean} Draw tiles lines and ids */
    this._debug = options.debug || false;
    /** @type {Array<String>} List of visible layers */
    this._visibleLayers = options.visibleLayers || null;
    /** @type {Array<String>} List of layers that are clickable */
    this._clickableLayers = options.clickableLayers || null;
    /** @type {boolean} Load tiles in cache to avoid duplicated requests */
    this._cache = options.cache || false;
    /** @type {number} Default tile size */
    this._tileSize = options.tileSize || 256;
    /** @type {filterFn} filter function to allow/deny features */
    this._filter = options.filter || false; // Filter features
    /** @type {Record<string, string>} Additional headers to add when requesting tiles from the server */
    this._xhrHeaders = options.xhrHeaders || {}; // Headers added to every url request
    /** @type {Record<string, TileContext>} List of tiles drawn. Only populated when cache enabled */
    this._tilesDrawn = {};
    /** @type {drawFn} */
    this._customDraw = options.customDraw || null;
    /** @type {boolean} Allow multiple selection */
    this._multipleSelection;


    this._visibleTiles = []; // tiles currently in the viewport
    this._selectedFeatures = []; // list of selected features


    // Public properties
    /** @type {google.maps.Map} */
    this.map = map;

    /** @type {featureIdFn} Function to get id for layer feature */
    this.getIDForLayerFeature = options.getIDForLayerFeature || defaultFeatureIdFn;
    /** @type {google.maps.Size} */
    this.tileSize = new window.google.maps.Size(this._tileSize, this._tileSize);
    /** @type {styleFn|StyleOptions} */
    this.style = options.style || defaultStyleFn;

    if (options.selectedFeatures) {
      this.setSelectedFeatures(options.selectedFeatures);
    }
    /** @type {Record<string, MVTLayer>} Keep a list of the layers contained in the PBFs */
    this.mVTLayers = {};

    // Init
    this.map.addListener('zoom_changed', () => {
      this._visibleTiles = [];
      if (!this._cache) {
        this.mVTLayers = {};
      }
    });
  }

  /**
   * Invoked by the Google Maps API as part of the MapType interface.
   * Returns a tile for the given tile coordinate (x, y) and zoom level. This tile will be appended to the given
   * ownerDocument. Not available for base map types.
   * @param {google.maps.Point} tileCoord
   * @param {number} zoom
   * @param {Document} ownerDocument
   * @return {Element}
   */
  getTile(tileCoord, zoom, ownerDocument) {
    const tileContext = this.drawTile(tileCoord, zoom, ownerDocument);
    this._visibleTiles[tileContext.id] = tileContext;
    return tileContext.canvas;
  }

  /**
   * Invoked by the Google Maps API as part of the MapType interface.
   * Releases the given tile, performing any necessary cleanup. The provided tile will have already been removed from
   * the document. Optional.
   * @param {Element} tile
   */
  releaseTile(tile) {}

  /**
   * @param {google.maps.Point} coord
   * @param {number} zoom
   * @param {Document} ownerDocument
   * @return {TileContext}
   */
  drawTile(coord, zoom, ownerDocument) {
    const id = getTileString(zoom, coord.x, coord.y);
    if (this._tilesDrawn[id]) {
      return this._tilesDrawn[id];
    }
    const canvas = createCanvas(ownerDocument, id, this._tileSize);
    const parentId = getParentId(id, this._sourceMaxZoom);
    const tileContext = {
      id,
      canvas,
      zoom,
      tileSize: this._tileSize,
      parentId,
    };
    this._fetchTile(tileContext);
    return tileContext;
  }

  /**
   * @param {TileContext} tileContext
   */
  async _fetchTile(tileContext) {
    const id = tileContext.parentId || tileContext.id;
    const tile = getTileFromString(id);

    const src = this._url.replace('{z}', tile.zoom).replace('{x}', tile.x).replace('{y}', tile.y);
    /** @type {Response} */
    let response;
    try {
      response = await fetch(src, {
        headers: this._xhrHeaders,
      });
    } catch (error) {
      console.error(new Error(`Error fetching tile ${src}`), error);
    }
    if (response.ok) {
      // If the zoom has changed since the request was made, don't draw the tile
      if (this.map.getZoom() != tileContext.zoom) return;

      const arrayBuffer = await response.arrayBuffer();
      const vectorTile = new VectorTile((new Pbf((new Uint8Array(arrayBuffer)))));
      this._drawVectorTile(vectorTile, tileContext);
    }
    this._drawDebugInfo(tileContext);
  }

  /**
   * @param {VectorTile} vectorTile
   * @param {TileContext} tileContext
   */
  _drawVectorTile(vectorTile, tileContext) {
    // If the user has specified a list of layers to draw, only draw those layers
    const layers = this._visibleLayers ? this._visibleLayers : Object.keys(vectorTile.layers);
    layers.forEach((key) => {
      if (!vectorTile.layers[key]) return; // If the user has specified a layer that doesn't exist, skip it
      this._drawVectorTileLayer(vectorTile.layers[key], key, tileContext);
    });

    tileContext.vectorTile = vectorTile;
    if (!this._cache) return;
    // If cache is enabled, store the TileContext in the cache
    this._tilesDrawn[tileContext.id] = tileContext;
  }

  /**
   * @param {VectorTileLayer} vectorTileLayer
   * @param {string} name
   * @param {TileContext} tileContext
   */
  _drawVectorTileLayer(vectorTileLayer, name, tileContext) {
    if (!this.mVTLayers[name]) {
      this.mVTLayers[name] = this._createMVTLayer(name);
    }
    const mVTLayer = this.mVTLayers[name];
    mVTLayer.parseVectorTileFeatures(this, vectorTileLayer, tileContext);
  }

  /**
   * Creates a new MVTLayer instance
   * @param {string} name name of the layer
   * @return {MVTLayer} MVTLayer instance
   */
  _createMVTLayer(name) {
    const options = {
      getIDForLayerFeature: this.getIDForLayerFeature,
      style: this.style,
      name,
      filter: this._filter,
      customDraw: this._customDraw,
    };
    return new MVTLayer(options);
  }

  /**
   * @param {TileContext} tileContext
   */
  _drawDebugInfo(tileContext) {
    if (!this._debug) return;
    const tile = getTileFromString(tileContext.id);
    const width = this._tileSize;
    const height = this._tileSize;
    const context2d = tileContext.canvas.getContext('2d');
    context2d.strokeStyle = '#000000';
    context2d.fillStyle = '#FFFF00';
    context2d.font = '12px Arial';
    context2d.strokeRect(0, 0, width, height); // outer border
    context2d.fillRect(0, 0, 5, 5); // top left corner marker
    context2d.fillRect(0, height - 5, 5, 5); // bottom left corner marker
    context2d.fillRect(width - 5, 0, 5, 5); // top right corner marker
    context2d.fillRect(width - 5, height - 5, 5, 5); // bottom right corner marker
    context2d.fillRect(width / 2 - 5, height / 2 - 5, 10, 10); // center marker
    context2d.strokeText(`Z: ${tileContext.zoom} X: ${tile.x} Y: ${tile.y}`, 10, 20);
    if (tileContext.vectorTile) {
      context2d.strokeText(`Layers: ${Object.keys(tileContext.vectorTile.layers).length}`, 10, 20 + 15);
      Object.entries(tileContext.vectorTile.layers).forEach(([key, layer], index) => {
        context2d.strokeText(`${key}: ${layer.length}`, 10, 20 + 15 + (index + 1) * 15);
      });
    }
  }

  onClick(event, callbackFunction, options) {
    this._multipleSelection = (options && options.multipleSelection) || false;
    options = this._getMouseOptions(options, false);
    this._mouseEvent(event, callbackFunction, options);
  }

  onMouseHover(event, callbackFunction, options) {
    this._multipleSelection = false;
    options = this._getMouseOptions(options, true);
    this._mouseEvent(event, callbackFunction, options);
  }

  _getMouseOptions(options, mouseHover) {
    return {
      mouseHover: mouseHover,
      setSelected: options.setSelected || false,
      toggleSelection: (options.toggleSelection === undefined || options.toggleSelection),
      limitToFirstVisibleLayer: options.limitToFirstVisibleLayer || false,
      delay: options.delay || 0,
    };
  }

  _mouseEvent(event, callbackFunction, options) {
    if (!event.pixel || !event.latLng) return;

    if (options.delay == 0) {
      return this._mouseEventContinue(event, callbackFunction, options);
    }

    this.event = event;
    const me = this;
    setTimeout(function() {
      if (event != me.event) return;
      me._mouseEventContinue(me.event, callbackFunction, options);
    }, options.delay, event);
  }
  _mouseEventContinue(event, callbackFunction, options) {
    callbackFunction = callbackFunction || function() { };
    const limitToFirstVisibleLayer = options.limitToFirstVisibleLayer || false;
    const zoom = this.map.getZoom();
    const tile = MERCATOR.getTileAtLatLng(event.latLng, zoom);
    const id = getTileString(tile.z, tile.x, tile.y);
    const tileContext = this._visibleTiles[id];
    if (!tileContext) {
      return;
    }
    event.tileContext = tileContext;
    event.tilePoint = MERCATOR.fromLatLngToTilePoint(this.map, event);

    const clickableLayers = this._clickableLayers || Object.keys(this.mVTLayers) || [];
    for (let i = clickableLayers.length - 1; i >= 0; i--) {
      const key = clickableLayers[i];
      const layer = this.mVTLayers[key];
      if (layer) {
        var event = layer.handleClickEvent(event, this);
        this._mouseSelectedFeature(event, callbackFunction, options);
        if (limitToFirstVisibleLayer && event.feature) {
          break;
        }
      }
    }
  }

  _mouseSelectedFeature(event, callbackFunction, options) {
    if (options.setSelected) {
      const feature = event.feature;
      if (feature) {
        if (options.mouseHover) {
          if (!feature.selected) {
            feature.setSelected(true);
          }
        } else {
          if (options.toggleSelection) {
            feature.setSelected(!feature.selected);
          } else {
            if (!feature.selected) {
              feature.setSelected(true);
            }
          }
        }
      } else {
        if (options.mouseHover) {
          this.deselectAllFeatures();
        }
      }
    }
    callbackFunction(event);
  }

  deselectAllFeatures() {
    const zoom = this.map.getZoom();
    const tilesToRedraw = [];
    for (const featureId in this._selectedFeatures) {
      const mVTFeature = this._selectedFeatures[featureId];
      if (!mVTFeature) continue;
      mVTFeature.setSelected(false);
      const tiles = mVTFeature.tiles;
      for (const id in tiles) {
        delete this._tilesDrawn[id];
        const idObject = getTileFromString(id);
        if (idObject.zoom == zoom) {
          tilesToRedraw[id] = true;
        }
      }
    }
    this.redrawTiles(tilesToRedraw);
    this._selectedFeatures = [];
  }

  featureSelected(mVTFeature) {
    if (!this._multipleSelection) {
      this.deselectAllFeatures();
    }
    this._selectedFeatures[mVTFeature.featureId] = mVTFeature;
  }

  featureDeselected(mvtFeature) {
    delete this._selectedFeatures[mvtFeature.featureId];
  }

  /**
   * @param {Array<String>} featuresIds
   */
  setSelectedFeatures(featuresIds) {
    if (featuresIds.length > 1) {
      this._multipleSelection = true;
    }
    this.deselectAllFeatures();
    for (let i = 0, length = featuresIds.length; i < length; i++) {
      const featureId = featuresIds[i];
      this._selectedFeatures[featureId] = false;
      for (const key in this.mVTLayers) {
        this.mVTLayers[key].setSelected(featureId);
      }
    }
  }

  isFeatureSelected(featureId) {
    return this._selectedFeatures[featureId] != undefined;
  }

  getSelectedFeatures() {
    const selectedFeatures = [];
    for (const featureId in this._selectedFeatures) {
      selectedFeatures.push(this._selectedFeatures[featureId]);
    }
    return selectedFeatures;
  }

  getSelectedFeaturesInTile(tileContextId) {
    const selectedFeatures = [];
    for (const featureId in this._selectedFeatures) {
      const selectedFeature = this._selectedFeatures[featureId];
      for (const tile in selectedFeature.tiles) {
        if (tile == tileContextId) {
          selectedFeatures.push(selectedFeature);
        }
      }
    }
    return selectedFeatures;
  }

  setFilter(filter, redrawTiles) {
    redrawTiles = (redrawTiles === undefined || redrawTiles);
    this._filter = filter;
    for (const key in this.mVTLayers) {
      this.mVTLayers[key].setFilter(filter);
    }
    if (redrawTiles) {
      this.redrawAllTiles();
    }
  }

  setStyle(style, redrawTiles) {
    redrawTiles = (redrawTiles === undefined || redrawTiles);
    this.style = style;
    for (const key in this.mVTLayers) {
      this.mVTLayers[key].setStyle(style);
    }

    if (redrawTiles) {
      this.redrawAllTiles();
    }
  }

  setVisibleLayers(visibleLayers, redrawTiles) {
    redrawTiles = (redrawTiles === undefined || redrawTiles);
    this._visibleLayers = visibleLayers;
    if (redrawTiles) {
      this.redrawAllTiles();
    }
  }

  getVisibleLayers() {
    return this._visibleLayers;
  }

  setClickableLayers(clickableLayers) {
    this._clickableLayers = clickableLayers;
  }

  redrawAllTiles() {
    this._tilesDrawn = {};
    this.redrawTiles(this._visibleTiles);
  }

  redrawTiles(tiles) {
    for (const id in tiles) {
      this.redrawTile(id);
    }
  }

  redrawTile(id) {
    delete this._tilesDrawn[id];
    const tileContext = this._visibleTiles[id];
    if (!tileContext || !tileContext.vectorTile) return;
    this.clearTile(tileContext.canvas);
    this._drawVectorTile(tileContext.vectorTile, tileContext);
  }

  clearTile(canvas) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  setUrl(url, redrawTiles) {
    redrawTiles = (redrawTiles === undefined || redrawTiles);
    this._url = url;
    this.mVTLayers = [];
    if (redrawTiles) {
      this.redrawAllTiles();
    }
  }
}

export {
  MVTSource,
  getTileFromString,
};
