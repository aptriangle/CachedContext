#CachedContext

## What and Why

CachedContext is a function that, when given a CanvasRenderingContext2D, returns a proxy object that has all the functions and properties of the CanvasRenderingContext2D, along with several additional functions. The purpose of the proxy object is to log all of the function calls and property sets so that they can be rerun, partially or completely, later.

Because the CanvasRenderingContext2D is a state machine, there's no built-in way to undo a previous operation, or remove something that was previously drawn, or keep only some of the shapes that were previously drawn while clearing the rest. The correct way to handle a requirement for any of those things is to keep everything you need to redraw the canvas separately, then completely redraw the canvas every time a change is made. If that's not practical, or you need a temporary hack, CachedContext may work for you.

CachedContext does handle changes made to Path2D or Gradient objects after they are used, so changes to those objects will not cause the rerun to produce different results.

On a side note, the proxy object has an array called cachedCommands, which is all the recorded function calls and property changes, and it is useful for unit testing.

## How To Use

To use it, pass the context to CacheContext, and then use the result in the same way you would the context.


```javascript
const context = storeCanvas.getContext('2d');
const proxyContext = CachedContext(context);
proxyContext.fillStyle = 'red';
proxyContext.fillRect(10, 10, 200, 200);
```

You can clear the original context and then call rerun, which will perform the fillStyle and fillRect operations on the context again.


```javascript
testContext.clearRect(-200, -200, 500, 500);
proxyContext.rerun();
```

If you don't want to rerun everything, you can create save points. The example below draws three rectangles, then uses rerun to draw them in the opposite order:

```javascript
const save1 = proxyContext.saveState();
proxyContext.fillStyle = 'red';
proxyContext.fillRect(10, 10, 200, 200);
const save2 = proxyContext.saveState();
proxyContext.fillStyle = 'blue';
proxyContext.fillRect1(10, 110, 200, 200);
const save3 = proxyContext.saveState();
proxyContext.fillStyle = 'green'
proxyContext.fillRect1(210, 210, 200, 200);
const save4 = proxyContext.saveState();

context.clearRect(-200, -200, 500, 500);
proxyContext.rerun(save3, save4);
proxyContext.rerun(save2, save3);
proxyContext.rerun(save1, save2);
```

## Speed

Right now, Chrome seems to run at half speed when running through the proxy, whereas Firefox shows almost no reduction in speed (98.9%). 

I'm actually a little surprised by those figures.

## What it Can't Do

If you use a function that draws image data to the context, like drawImage, and then the source of that data changes before you call rerun, the result will change. This is normally not a problem, because drawImage is usually used to draw loaded image files to the canvas, and people don't usually change the src of an Image after it is loaded and used. It is possible to modify CachedContext to cache drawn images, but the memory/performance requirements of storing bitmap data would be large.

## Functions

### rerun(start, end)

Performs the recorded function calls and property sets on the CanvasRenderingContext2D. If no parameters are provided, it reruns all recorded commands. If start or end parameters are provided, they represent the indexes of the commands that are the first and last commands that should be rerun. indexes are returned by saveState, getSaveStateIndexes, and getDrawIndexes. They can also be seen in the cachedCommands array of the proxy, as the index properties of the objects in that array.

### getDrawIndexes

Gets the indexes of the function calls that actually change pixels. So this would return the indexes of calls to fill(), but not calls to moveTo().

### getSaveStateIndexes

Gets the indexes returned by previous calls to saveState.

### saveState

Saves the current state of the context, including all of the properties of the CanvasRenderingContext2D and the current transform. Then it returns the command index of the saved state, which can be passed to rerun as a start or end.

## Is This Good Code

Definitely not. It's a hack I threw together to temporarily solve a small problem and I keep going back to it to temporarily solve other small problems. I swear I've written systems that use the 2d context correctly. It doesn't use the official js Proxy<>, because Proxy<> doesn't like native objects, so it uses a lot of meta programming. If you try to put it through a linter, the linter would probably explode.

On the other hand, it works quite well, it's reasonably fast, it doesn't need to be updated when new features are added to the CanvasRenderingContext2D, it can be dropped in a system that's using the CanvasRenderingContext2D with no changes, and it's only 200 lines of code in one file with no dependencies.

## How Does it Work

On a basic level, it gets all the property/function names from the CanvasRenderingContext2D and adds matching functions and properties to the returned proxy object. When a function is called or a property is set, that is logged in the cachedCommands array and then the function call or property set is passed on to the original CanvasRenderingContext2D. The rerun function on the proxy object can then perform the stored operations on the original CanvasRenderingContext2D again.

Internally, the proxy intercepts the creation of new gradients to create another proxy object that will log addColorStop calls to the original proxy. This is because gradients can be modified, by adding additional color stops, after they are used. To allow rerun to not be influenced by that, new gradient objects are created while rerunning, so that color stops can be added at the correct time.

The proxy also provides the saveState function, which saves all the properties of the CanvasRenderingContext2D, and the current transform, to the cachedCommands array and returns the index of the savestate command.

Because clip sticks with the canvas unless save/restore is used, the proxy calls save before every call to clip. If restore is later called, it calls restore additional times to match the extra save calls. If rerun is called before restore is called, it calls restore for every unmatched save that has occurred.