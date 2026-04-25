import { TileEntityLargeRailCore, TileEntityLargeRailSwitchCore } from "jp.ngt.rtm.rail";
import { Point, RailDir, RailMapSwitch } from "jp.ngt.rtm.rail.util";

function renderRailDynamic2(tileEntity: TileEntityLargeRailSwitchCore, par2: number, par4: number, par6: number): void;
function renderPoint(tileEntity: TileEntityLargeRailSwitchCore, point: Point): void;
function renderRailMapDynamic(tileEntity: TileEntityLargeRailCore, rms: RailMapSwitch, dir: RailDir, par3: boolean, move: number, tongIndex: number): void;
function sigmoid2(x: number): number;