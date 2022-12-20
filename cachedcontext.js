/**
 * Creates a proxy object that wraps a provided CanvasRenderingContext2D, providing access to all of the functions and properties of the underlying CanvasRenderingContext2D object, along with several functions specific to the proxy.
 * The purpose of the proxy object is to log all function calls and property changes, so that they can be rerun, partially or completely, later. For example, you can rerun coommands up to a point before a mistake was made (creating an undo), or replay the drawing done by a section of code that you do not want to call repeatedly.
 * Calling "rerun" on the proxy, with no parameters, will rerun all context function calls and property changes, from the start. Calling saveState on the proxy will return a number that can be passed to rerun as the points where the rerun should start and end "rerun(start, end)".
 * Also available is getSaveStateIndexes, which provides all of the indexes previously provided by saveState, and getDrawIndexes, which provides all of the indexes where the shown pixels could have changed.
 * @param {CanvasRenderingContext2D} context A 2d context object that will be wrapped by the proxy
 * @returns An object that has all of the functions and properties of the CanvasRenderingContext2D, along with additional functions specific to the CachedContext
 */
function CachedContext(context) {
    const primativeProperties = [];
    let commandIndex = 0;
    let gradientIndex = 0;
    const saveStack = [];
    // a list of the functions that change the pixels of the canvas
    const changeNames = ['clearRect', 'drawImage', 'fill', 'fillRect', 'fillText', 'putImageData', 'stroke', 'strokeRect', 'strokeText'];
    /**
     * The proxy object, to which all of the functions and properties of the context, plus special commands unique to CachedContext, wil be added
     * Proxy<> is not used here, becasue that does not play nice with native objects like the CanvasRenderingContext2D
     */
    const proxy = {
        cachedCommands: [],
        gradients: []
    };
    /**
     * Rerun runs stored property changes and function calls on the context
     * @param {number} from The index property of the command to start from. If not provided, defaults to the first command in the cachedCommants
     * @param {number} to The index property of the command to stop at. If not provided, defaults to the last command in the cachedCommants
     */
    proxy.rerun = (from, to, nodraw) => {
        from = from ? proxy.cachedCommands.findIndex(command => command.index == from) : 0;
        to = to ? proxy.cachedCommands.findIndex(command => command.index == to) : proxy.cachedCommands.length - 1;

        // if there are saves that do not have matching restores in the commandList, call restore for them all
        if (!nodraw) {
            for (let save of saveStack) {
                if (save.index > proxy.cachedCommands[from].index && save.index < proxy.cachedCommands[to].index) {
                    context.restore();
                }
            }
        }

        const gradientStore = new Map();
        for (let i = from; i <= to; i++) {
            const command = proxy.cachedCommands[i];
            if (command.type == 'function') {
                if (nodraw && changeNames.indexOf(command.name) != -1) {
                    continue;
                }
                // if the command was a function call, call the function on the context
                const returnValue = context[command.name](...command.values);
                // if the return value is a CanvasGradient, store it so that we can rerun addGradientStop calls
                if (returnValue instanceof CanvasGradient) {
                    gradientStore.set(command.gradientIndex, returnValue);
                }
            } else if (command.type == 'colorstop') {
                // rerun addColorStop commands on the new gradient, created during this rerun
                if (!gradientStore.has(command.gradientIndex)) {
                    continue;
                }
                gradientStore.get(command.gradientIndex).addColorStop(...command.values);
            } else if (command.type == 'savestate') {
                for (let prop of primativeProperties) {
                    context[prop] = command.state[prop];
                }
                context.setTransform(command.state['transform']);
            } else {
                // if it wasn't one of the branches above, the comamnd was a change to a property
                if (command.values[0].proxied) {
                    // if the property set was setting a gradient, use gradients created during this rerun
                    if (command.values[0].proxied instanceof CanvasGradient) {
                        context[command.name] = gradientStore.get(command.values[0].gradientIndex);
                    } else {
                        context[command.name] = command.values[0].proxied;
                    }
                } else {
                    context[command.name] = command.values[0];
                }
            }
        }
    }
    /**
     * Gets the indexes where the shown image could have changed
     */
    proxy.getDrawIndexes = () => {
        return proxy.cachedCommands.filter(command => command.name && changeNames.indexOf(command.name) != -1).map(command => command.index);
    }
    /**
     * Gets the indexes where saveState was called
     */
    proxy.getSaveStateIndexes = () => {
        return proxy.cachedCommands.filter(command => command.type == 'savestate').map(command => command.index);
    }
    /**
     * Save all of the context's primative values, along with the current transform
     * @returns The index property of the save state
     */
    proxy.saveState = () => {
        const state = {};
        for (let prop of primativeProperties) {
            state[prop] = context[prop];
        }
        state['transform'] = context.getTransform();
        proxy.cachedCommands.push({
            type: 'savestate',
            state,
            index: ++commandIndex,
        });
        return commandIndex;
    }
    // the function names that cause CachedContext to call save on the contained context
    let saveNames = ['save', 'clip'];
    // some of the properties are not on the context's level, so recurse
    let search = context;
    do {
        const properties = Object.getOwnPropertyNames(search);
        // but stop recursing when we have reached generic objects
        if (properties.indexOf('hasOwnProperty') != -1) {
            break;
        }
        for (let name of properties) {
            // if the context property is a function, add a matching function to the proxy
            if (typeof context[name] == 'function') {
                proxy[name] = (...args) => {
                    if (!context[name]) {
                        throw new Error('Tried to call function ' + name + ' that does not exist on the context');
                    }
                    let cIndex = ++commandIndex;
                    // some context commands (like clip) can only be reverted with save/restore, so call save before clip, then call restore extra times when it is called so that save/restores match
                    if (saveNames.indexOf(name) != -1) {
                        saveStack.push({
                            name,
                            index: cIndex
                        });
                        if (name != 'save') {
                            context.save();
                        }
                    }
                    if (name == 'restore') {
                        let restored = saveStack.length > 0;
                        while (!restored) {
                            let save = saveStack.pop();
                            restored = save.name == 'save';
                            if (save.name != 'save') {
                                context.restore();
                            }
                        }
                    }
                    // the function on the proxy object has been called, so first call the matching function on the context
                    let returnValue = context[name](...args);
                    // if a Path2D is being passed to the function, store a copy so that any changes to the original Path2D will not change the rerun
                    if (args[0] instanceof Path2D) {
                        args[0] = new Path2D(args[0]);
                    }
                    // if the function returned a gradient, create another object that will intercept addColorStop calls on the gradient object
                    if (returnValue instanceof CanvasGradient) {
                        const gIndex = ++gradientIndex;
                        const storedGradient = returnValue;
                        returnValue = {
                            proxied: storedGradient,
                            gradientIndex: gIndex,
                            addColorStop: (...innerArgs) => {
                                // when addColorStop is called on the gradient proxy, store the call in the context proxy, along with the index of the gradient
                                proxy.cachedCommands.push({
                                    type: 'colorstop',
                                    values: innerArgs,
                                    gradientIndex: gIndex,
                                    index: ++commandIndex
                                })
                                // call addColor stop on the CanvasGradient
                                storedGradient.addColorStop(...innerArgs);
                            }
                        }
                        proxy.gradients.push(returnValue);
                    }
                    // store the function call
                    proxy.cachedCommands.push({
                        type: 'function',
                        name,
                        values: args,
                        index: cIndex,
                        gradientIndex
                    });
                    return returnValue;
                }
            } else {
                const propName = name;
                if (typeof context[name] == 'boolean' || typeof context[name] == 'number' || typeof context[name] == 'string') {
                    primativeProperties.push(name);
                }
                // add all properties that exist on the context, to the proxy
                Object.defineProperty(proxy, name, {
                    get: () => {
                        // when getting properties, get the values directy from the context
                        return context[propName]
                    },
                    set: (val) => {
                        // when setting properties, store the property change, then pass to the context
                        proxy.cachedCommands.push({
                            type: 'property',
                            name: propName,
                            values: [val],
                            index: ++commandIndex
                        })
                        if (val.proxied) {
                            val = val.proxied;
                        }
                        context[propName] = val;
                    }
                })
            }
        }
    } while ((search = Object.getPrototypeOf(search)))
    // save the initial state (when proxy is created)
    proxy.saveState();
    return proxy;
}