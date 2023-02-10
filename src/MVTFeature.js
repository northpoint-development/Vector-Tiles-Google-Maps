/*
 *  Created by Jes�s Barrio on 04/2021
 */

import {getTileFromString} from './MVTSource';

/**
 * @typedef {import('./MVTSource').MVTSource} MVTSource
 * @typedef {import('./MVTSource').TileContext} TileContext
 * @typedef {import('./MVTSource').StyleOptions} StyleOptions
 * @typedef {import('./MVTSource').drawFn} drawFn
 *
 * @typedef {import('@mapbox/vector-tile').VectorTileFeature} VectorTileFeature
 */

/**
 * @typedef {object} MVTFeatureOptions
 * @property {MVTSource} mVTSource
 * @property {boolean} selected Indicates if these feature has ben selected and should be using the "selected" styles
 * @property {string} featureId The feature id
 * @property {StyleOptions} style
 * @property {VectorTileFeature} vectorTileFeature
 * @property {TileContext} tileContext
 * @property {drawFn} customDraw
 */

/**
 * @typedef {object} FeatureTile
 * @property {VectorTileFeature} vectorTileFeature
 * @property {number} divisor
 * @property {Path2D} paths2d
 */

/**
   * @param {google.maps.Point} point
   * @param {TileContext} tileContext
   * @return {google.maps.Point}
   */
const getOverZoomedPoint = (point, tileContext) => {
  const parentTile = getTileFromString(tileContext.parentId);
  const currentTile = getTileFromString(tileContext.id);
  const zoomDistance = currentTile.zoom - parentTile.zoom;

  const scale = Math.pow(2, zoomDistance);

  const xScale = point.x * scale;
  const yScale = point.y * scale;

  const xTileOffset = currentTile.x % scale;
  const yTileOffset = currentTile.y % scale;

  const newPoint = new window.google.maps.Point(
      xScale - (xTileOffset * tileContext.tileSize),
      yScale - (yTileOffset * tileContext.tileSize),
  );

  return newPoint;
};

/**
 * Scales a point to the current tile
 * @param {google.maps.Point} coords
 * @param {TileContext} tileContext
 * @param {Number} [divisor=1]
 * @return {google.maps.Point}
 */
const getPoint = (coords, tileContext, divisor = 1) => {
  const point = new window.google.maps.Point(coords.x / divisor, coords.y / divisor);

  if (tileContext.parentId) {
    return getOverZoomedPoint(point, tileContext);
  }
  return point;
};

/**
 * Accepts a canvas and optionally applies styles from a StyleOptions object before returning the context2d for
 * drawing.
 * @param {HTMLCanvasElement} canvas
 * @param {StyleOptions} [style={}]
 * @return {CanvasRenderingContext2D}
 */
const getContext2d = (canvas, style = {}) => {
  const context2d = canvas.getContext('2d');
  for (const key in style) {
    if (key === 'selected') continue;
    context2d[key] = style[key];
  }
  return context2d;
};

/**
 * Builds a line along all the paths in the geometry and adds each to the tile's paths2d without closing the path
 * or drawing the stroke
 * @param {TileContext} tileContext
 * @param {FeatureTile} tile
 * @return {Path2D}
 */
const drawGeometry = (tileContext, tile) => {
  const geometry = tile.vectorTileFeature.loadGeometry();
  geometry.forEach((path) => {
    const path2d = new Path2D();
    path.forEach((rawPoint, i) => {
      const p = getPoint(rawPoint, tileContext, tile.divisor);
      const operation = i === 0 ? 'moveTo' : 'lineTo'; // if this is the first point, move to it without drawing
      path2d[operation](p.x, p.y);
    });
    tile.paths2d.addPath(path2d);
  });
  return tile.paths2d;
};

/**
 * @param {TileContext} tileContext
 * @param {FeatureTile} tile
 * @param {StyleOptions} style
 */
const drawPoint = (tileContext, tile, style) => {
  const coordinates = tile.vectorTileFeature.loadGeometry()[0][0];
  const point = getPoint(coordinates, tileContext, tile.divisor);
  const radius = style.radius || 3;
  const context2d = getContext2d(tileContext.canvas, style);
  context2d.beginPath();
  context2d.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context2d.closePath();
  context2d.fill();
  context2d.stroke();
};

/**
 * @param {TileContext} tileContext
 * @param {FeatureTile} tile
 * @param {StyleOptions} style
 */
const drawLineString = (tileContext, tile, style) => {
  const context2d = getContext2d(tileContext.canvas, style);
  context2d.stroke(drawGeometry(tileContext, tile));
};

/**
 * @param {TileContext} tileContext
 * @param {FeatureTile} tile
 * @param {StyleOptions} style
 */
const drawPolygon = (tileContext, tile, style) => {
  const paths = drawGeometry(tileContext, tile);
  paths.closePath();

  const context2d = getContext2d(tileContext.canvas, style);
  if (style.fillStyle) {
    context2d.fill(paths);
  }
  if (style.strokeStyle) {
    context2d.stroke(paths);
  }
};

const getDefaultDraw = (/** @type {1|2|3} */type) => {
  /**
   * Default draw method handles drawing points, linestrings and polygons using the built in draw methods which
   * use the currently applied style.
   * @param {TileContext} tileContext
   * @param {FeatureTile} tile
   * @param {StyleOptions} style
   */
  const defaultDraw = (tileContext, tile, style) => {
    const drawFns = {
      1: drawPoint,
      2: drawLineString,
      3: drawPolygon,
    };
    drawFns[type]?.(tileContext, tile, style);
  };
  return defaultDraw;
};

class MVTFeature {
  /**
   * @param {MVTFeatureOptions} options
   */
  constructor(options = {}) {
    /** @type {MVTSource} */
    this.mVTSource = options.mVTSource;
    /** @type {boolean} Indicates if these feature has ben selected and should be using the "selected" styles */
    this.selected = options.selected;
    /** @type {string} The feature id */
    this.featureId = options.featureId;
    /** @type {StyleOptions} */
    this.style = options.style;
    /** @type {1|2|3} */
    this.type = options.vectorTileFeature.type;
    /** @type {object} */
    this.properties = options.vectorTileFeature.properties;

    /** @type {drawFn} */
    this._draw = options.customDraw || getDefaultDraw(this.type);

    /** @type {Record<string, FeatureTile>} */
    this.tiles = {};

    this.addTileFeature(options.vectorTileFeature, options.tileContext);
    if (this.selected) {
      this.setSelected(true);
    }
  }

  /**
   * @param {VectorTileFeature} vectorTileFeature
   * @param {TileContext} tileContext
   */
  addTileFeature(vectorTileFeature, tileContext) {
    this.tiles[tileContext.id] = {
      vectorTileFeature: vectorTileFeature,
      divisor: vectorTileFeature.extent / tileContext.tileSize,
      paths2d: new Path2D(),
    };
  }

  /**
   * Redraw all the tiles that this feature is in. Used to apply styling changes
   */
  redrawTiles() {
    const mapZoom = this.mVTSource.map.getZoom();
    Object.keys(this.tiles).forEach((tileId) => {
      if (getTileFromString(tileId).zoom !== mapZoom) return;
      this.mVTSource.redrawTile(tileId);
    });
  }

  /**
   * Set this feature as selected or not. The feature will be redrawn with the correct style
   * @param {boolean} selected
   */
  setSelected(selected) {
    this.selected = selected;
    if (selected) {
      this.mVTSource.featureSelected(this);
    } else {
      this.mVTSource.featureDeselected(this);
    }
    this.redrawTiles();
  }

  /**
   * Draws the given tile using the correct style based on selected state
   * @param {TileContext} tileContext
   */
  draw(tileContext) {
    // if this feature has been selected and a selected style is available, use that style. Otherwise use the default
    const style = this.selected && this.style.selected ? this.style.selected : this.style;
    this._draw(tileContext, this.tiles[tileContext.id], style, this);
  }

  /**
   * Returns the scaled paths for this feature
   * @param {TileContext} tileContext
   * @return {Array<Array<Point>>}
   */
  getPaths(tileContext) {
    /** @type {Array<Array<Point>>} */
    const paths = [];
    const tile = this.tiles[tileContext.id];
    const geometry = tile.vectorTileFeature.loadGeometry();
    geometry.forEach((path) => {
      /** @type {Array<Point>} */
      const scaledPath = [];
      path.forEach((rawPoint) => {
        scaledPath.push(getPoint(rawPoint, tileContext, tile.divisor));
      });
      if (scaledPath.length > 0) {
        paths.push(scaledPath);
      }
    });
    return paths;
  }

  /**
   * Returns whether or not a given point exists in any path in the feature
   * @param {Point} point
   * @param {TileContext} tileContext
   * @return {boolean}
   */
  isPointInPath(point, tileContext) {
    const tile = this.tiles[tileContext.id];
    const context2d = getContext2d(tileContext.canvas);
    if (!context2d || !tile.paths2d) {
      return false;
    }
    return context2d.isPointInPath(tile.paths2d, point.x, point.y);
  }
}

export {
  MVTFeature,

  getPoint,
  getContext2d,
  drawGeometry,
  drawPoint,
  drawLineString,
  drawPolygon,
};
