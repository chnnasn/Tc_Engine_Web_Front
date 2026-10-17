"""Import the supplied Unity Shelter assets without modifying the source project.
Usage: python scripts/import-shelter.py --source E:/Github/Shelter --ffmpeg /path/to/ffmpeg
"""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--ffmpeg',default='ffmpeg');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];project=root/'samples/shelter';source=args.source
# These are the three sprites actually serialized in SampleScene.GridManager.
# The standalone tree/rock illustrations are not map tiles in the Unity scene.
items=[('CodeMonkey/Assets/White_1x1.png','Art/white.png',19,'Texture2D'),('Image/UI/主页面背景.png','Art/menu.png',10,'Texture2D'),('Image/UI/标题.png','Art/title.png',11,'Texture2D'),('Image/building/main.png','Art/ground.png',12,'Texture2D'),('Image/building/Resource.png','Art/wood.png',13,'Texture2D'),('Image/building/build.png','Art/stone.png',14,'Texture2D'),('Image/building/主城.png','Art/castle.png',15,'Texture2D'),('Image/building/食物产出房.png','Art/farm.png',16,'Texture2D'),('Image/building/城墙.png','Art/wall.png',17,'Texture2D'),('Image/UI/游戏界面UI.png','Art/frame.png',18,'Texture2D'),('站酷快乐体2016修订版.ttf','Fonts/shelter.ttf',20,'Font')]
for name,target,n in [('开始游戏','start',40),('退出游戏','quit',41),('设置UI','settings',42),('派遣UI','dispatch',43),('建造背景UI','build-panel',44),('建造UI','build-button',45),('取消UI','cancel',46),('派遣背景UI','dispatch-panel',47),('派遣确认UI','confirm',48),('派遣完成背景UI','report-panel',49),('继续游戏','continue',50),('返回主菜单','return-menu',51),('木材ui','wood-icon',52),('石头UI','stone-icon',53),('食物UI','food-icon',54)]:
 items.append(('Image/UI/'+name+'.png','Art/'+target+'.png',n,'Texture2D'))
for folder in ['Assets/Art','Assets/Fonts','Assets/Audio','Assets/Scene','Assets/Scripts','Reference']:(project/folder).mkdir(parents=True,exist_ok=True)
def metadata(path,n,kind):
 settings='\n    Usage: Sprite\n    sRGB: false\n    generateMipmaps: false\n    compression: rgba8' if kind=='Texture2D' else ' {}'
 Path(str(path)+'.tcmeta').write_text(f'SchemaVersion: 2\nAsset:\n  Handle: {6300000000000000000+n}\n  Type: {kind}\n  ImportSettings:{settings}\n  SubAssets: []\n',encoding='utf8')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
manifest=[]
for original,target,n,kind in items:
 src=source/'Assets'/original;dst=project/'Assets'/target;shutil.copyfile(src,dst);metadata(dst,n,kind)
 manifest.append(dict(source='Assets/'+original,path='Assets/'+target,sourceSha256=sha(src),sha256=sha(dst),conversion='byte-identical'))
original=source/'Assets/Image/Nocturne in Paris.mp3';target=project/'Assets/Audio/music.ogg'
# Strip embedded album art: otherwise ffmpeg writes Theora video into the OGG.
subprocess.run([args.ffmpeg,'-y','-hide_banner','-loglevel','error','-i',str(original),'-vn','-ar','22050','-ac','1','-c:a','libvorbis','-q:a','3',str(target)],check=True)
metadata(target,30,'Audio');shutil.copyfile(original,project/'Reference/music.mp3')
manifest.append(dict(source='Assets/Image/Nocturne in Paris.mp3',path='Assets/Audio/music.ogg',sourceSha256=sha(original),sha256=sha(target),conversion='full-length 22050 Hz mono Vorbis q3; embedded cover omitted'))
for name,n,kind in [('Scripts/ShelterGame.cs',1,'CSharpScript'),('Scene/shelter.tomcat',2,'Scene'),('Scripts/ShelterModel.cs',3,'CSharpScript')]:metadata(project/'Assets'/name,n,kind)
shutil.copyfile(source/'LICENSE',project/'LICENSE')
for name in ['GameManager.cs','CountDown.cs','Grid.cs','Maker.cs'] :shutil.copyfile(source/'Assets/Scripts'/name,project/'Reference'/(name+'.txt'))
(project/'Reference/assets.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
output=root/'public/samples/shelter';output.mkdir(parents=True,exist_ok=True);shutil.copyfile(project/'Assets/Art/menu.png',output/'cover.png')
print('Imported Shelter assets; run npm run engine:shelter to compile and cook.')
