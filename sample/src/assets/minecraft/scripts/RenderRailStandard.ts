import { ModelObject, Parts, RailPartsRenderer } from "jp.ngt.rtm.render";
import { TileEntityLargeRailCore, TileEntityLargeRailSwitchCore } from "jp.ngt.rtm.rail";
import { ModelSetRailClient } from "jp.ngt.rtm.modelpack.modelset";
import { renderRailDynamic2 } from "./LibRenderRail";

// RTM が renderClass を読んでレンダラーをインスタンス化する
declare const renderer: RailPartsRenderer;

declare global {
    var TONG_MOVE: number;
    var TONG_POS: number;
    var HALF_GAUGE: number;
    var YAW_RATE: number;

    var staticParts: Parts;
    var leftParts: Parts;
    var rightParts: Parts;
    var tongFL: Parts;
    var tongBL: Parts;
    var tongFR: Parts;
    var tongBR: Parts;
}

TONG_MOVE = 0.35;
TONG_POS = 1.0 / 10.0;
HALF_GAUGE = 0.5647;
/**レール長で割る*/
YAW_RATE = 450.0;

function init(par1: ModelSetRailClient, par2: ModelObject) {
    staticParts = renderer.registerParts(new Parts("base"));
    leftParts = renderer.registerParts(new Parts("railL", "sideL"));
    rightParts = renderer.registerParts(new Parts("railR", "sideR"));
    tongFL = renderer.registerParts(new Parts("L0"));
    tongBL = renderer.registerParts(new Parts("L1"));
    tongFR = renderer.registerParts(new Parts("R0"));
    tongBR = renderer.registerParts(new Parts("R1"));
}

function renderRailStatic(tileEntity: TileEntityLargeRailCore, posX: number, posY: number, posZ: number, par8: number, pass: number) {
    renderer.renderStaticParts(tileEntity, posX, posY, posZ);

    //MCP->SRGもうまくいく
    const x = tileEntity.xCoord;
    const y = tileEntity.yCoord;
    const z = tileEntity.zCoord;
}

function renderRailDynamic(tileEntity: TileEntityLargeRailCore, posX: number, posY: number, posZ: number, par8: number, pass: number) {
    if (renderer.isSwitchRail(tileEntity)) {
        renderRailDynamic2(tileEntity as unknown as TileEntityLargeRailSwitchCore, posX, posY, posZ);
    }
}

function shouldRenderObject(tileEntity: TileEntityLargeRailCore, objName: string, len: number, pos: number) {
    if (renderer.isSwitchRail(tileEntity))//分岐レール
    {
        //可動部パーツは除外
        return staticParts.containsName(objName);
    } else {
        return staticParts.containsName(objName) || leftParts.containsName(objName) || rightParts.containsName(objName);
    }
}