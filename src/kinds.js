
import kindOf from 'kind-of'
import invariant from 'invariant'

import isStruct from './is-struct'

/**
 * Kind.
 */

class Kind {

  constructor(name, type, validate) {
    this.name = name
    this.type = type
    this.validate = validate
  }

}

/**
 * Any.
 */

function any(schema, defaults, options) {
  if (isStruct(schema)) return schema.__kind
  if (schema instanceof Kind) return schema

  switch (kindOf(schema)) {
    case 'array': {
      return schema.length > 1
        ? tuple(schema, defaults, options)
        : list(schema, defaults, options)
    }

    case 'function': {
      return func(schema, defaults, options)
    }

    case 'object': {
      return object(schema, defaults, options)
    }

    case 'string': {
      let required = true
      let type

      if (schema.endsWith('?')) {
        required = false
        schema = schema.slice(0, -1)
      }

      if (schema.includes('|')) {
        const scalars = schema.split(/\s*\|\s*/g)
        type = union(scalars, defaults, options)
      } else if (schema.includes('&')) {
        const scalars = schema.split(/\s*&\s*/g)
        type = intersection(scalars, defaults, options)
      } else {
        type = scalar(schema, defaults, options)
      }

      if (!required) {
        type = optional(type, undefined, options)
      }

      return type
    }
  }

  invariant(false, `A schema definition must be an object, array, string or function, but you passed: ${schema}`)
}

/**
 * Dict.
 */

function dict(schema, defaults, options) {
  const obj = scalar('object', undefined, options)
  const keys = any(schema[0], undefined, options)
  const values = any(schema[1], undefined, options)
  const name = 'dict'
  const type = `dict<${keys.type},${values.type}>`
  const validate = (value = defaults) => {
    const [ error ] = obj.validate(value)

    if (error) {
      error.type = type
      return [error]
    }

    const ret = {}
    const errors = []

    for (let k in value) {
      const v = value[k]
      const [ e, r ] = keys.validate(k)

      if (e) {
        e.path = [k].concat(e.path)
        e.data = value
        errors.push(e)
        continue
      }

      k = r
      const [ e2, r2 ] = values.validate(v)

      if (e2) {
        e2.path = [k].concat(e2.path)
        e2.data = value
        errors.push(e2)
        continue
      }

      ret[k] = r2
    }

    if (errors.length) {
      const first = errors[0]
      first.errors = errors
      return [first]
    }

    return [undefined, ret]
  }

  return new Kind(name, type, validate)
}

/**
 * Enums.
 */

function enums(schema, defaults, options) {
  const name = 'enum'
  const type = schema.map((s) => {
    try {
      return JSON.stringify(s)
    } catch (e) {
      return String(s)
    }
  }).join(' | ')

  const validate = (value = defaults) => {
    return schema.includes(value)
      ? [undefined, value]
      : [{ data: value, path: [], value, type }]
  }

  return new Kind(name, type, validate)
}

/**
 * Function.
 */

function func(schema, defaults, options) {
  const name = 'function'
  const type = '<function>'
  const validate = (value = defaults) => {
    return schema(value)
      ? [undefined, value]
      : [{ type, value, data: value, path: [] }]
  }

  return new Kind(name, type, validate)
}

/**
 * List.
 */

function list(schema, defaults, options) {
  invariant(schema.length === 1, `List structs must be defined as an array with a single element, but you passed ${schema.length} elements.`)

  const array = scalar('array', undefined, options)
  const element = any(schema[0], undefined, options)
  const name = 'list'
  const type = `[${element.type}]`
  const validate = (value = defaults) => {
    const [ error, result ] = array.validate(value)

    if (error) {
      error.type = type
      return [error]
    }

    value = result
    const errors = []
    const ret = []

    for (let i = 0; i < value.length; i++) {
      const v = value[i]
      const [ e, r ] = element.validate(v)

      if (e) {
        e.path = [i].concat(e.path)
        e.data = value
        errors.push(e)
        continue
      }

      ret[i] = r
    }

    if (errors.length) {
      const first = errors[0]
      first.errors = errors
      return [first]
    }

    return [undefined, ret]
  }

  return new Kind(name, type, validate)
}

/**
 * Object.
 */

function object(schema, defaults, options) {
  invariant(kindOf(schema) === 'object', `Object structs must be defined as an object, but you passed: ${schema}`)

  const obj = scalar('object', undefined, options)
  const ks = []
  const properties = {}

  for (const key in schema) {
    ks.push(key)
    const s = schema[key]
    const d = defaults && defaults[key]
    const kind = any(s, d, options)
    properties[key] = kind
  }

  const name = 'object'
  const type = `{${ks.join()}}`
  const validate = (value = defaults) => {
    const [ error, result ] = obj.validate(value)

    if (error) {
      error.type = type
      return [error]
    }

    value = result
    const errors = []
    const ret = {}
    const valueKeys = Object.keys(value)
    const schemaKeys = Object.keys(properties)
    const keys = new Set(valueKeys.concat(schemaKeys))

    keys.forEach((key) => {
      const v = value[key]
      const kind = properties[key]

      if (!kind) {
        const e = { data: value, path: [key], value: v }
        errors.push(e)
        return
      }

      const [ e, r ] = kind.validate(v)

      if (e) {
        e.path = [key].concat(e.path)
        e.data = value
        errors.push(e)
        return
      }

      if (key in value) {
        ret[key] = r
      }
    })

    if (errors.length) {
      const first = errors[0]
      first.errors = errors
      return [first]
    }

    return [undefined, ret]
  }

  return new Kind(name, type, validate)
}

/**
 * Optional.
 */

function optional(schema, defaults, options) {
  return union([schema, 'undefined'], defaults, options)
}

/**
 * Scalar.
 */

function scalar(schema, defaults, options) {
  const { types } = options
  const fn = types[schema]
  invariant(typeof fn === 'function', `No struct validator function found for type "${schema}".`)
  const kind = func(fn, defaults, options)
  const name = 'scalar'
  const type = schema
  const validate = (value) => {
    const [ error, result ] = kind.validate(value)

    if (error) {
      error.type = type
      return [error]
    }

    return [undefined, result]
  }

  return new Kind(name, type, validate)
}

/**
 * Tuple.
 */

function tuple(schema, defaults, options) {
  const kinds = schema.map(s => any(s, undefined, options))
  const array = scalar('array', undefined, options)
  const name = 'tuple'
  const type = `[${kinds.map(k => k.type).join()}]`
  const validate = (value = defaults) => {
    const [ error ] = array.validate(value)

    if (error) {
      error.type = type
      return [error]
    }

    const ret = []
    const errors = []
    const length = Math.max(value.length, kinds.length)

    for (let i = 0; i < length; i++) {
      const kind = kinds[i]
      const v = value[i]

      if (!kind) {
        const e = { data: value, path: [i], value: v }
        errors.push(e)
        continue
      }

      const [ e, r ] = kind.validate(v)

      if (e) {
        e.path = [i].concat(e.path)
        e.data = value
        errors.push(e)
        continue
      }

      ret[i] = r
    }

    if (errors.length) {
      const first = errors[0]
      first.errors = errors
      return [first]
    }

    return [undefined, ret]
  }

  return new Kind(name, type, validate)
}

/**
 * Union.
 */

function union(schema, defaults, options) {
  const kinds = schema.map(s => any(s, undefined, options))
  const name = 'union'
  const type = kinds.map(k => k.type).join(' | ')
  const validate = (value = defaults) => {
    let error

    for (const k of kinds) {
      const [ e, r ] = k.validate(value)
      if (!e) return [undefined, r]
      error = e
    }

    error.type = type
    return [error]
  }

  return new Kind(name, type, validate)
}

/**
 * Intersection.
 */

function intersection(schema, defaults, options) {
  const types = schema.map(s => any(s, undefined, options))
  const name = 'intersection'
  const type = types.map(t => t.type).join(' & ')
  const validate = (value = defaults) => {
    let v = value

    for (const t of types) {
      const [ e, r ] = t.validate(v)

      if (e) {
        e.type = type
        return [e]
      }

      v = r
    }

    return [undefined, v]
  }

  return new Kind(name, type, validate)
}

/**
 * Export.
 *
 * @type {Function}
 */

export default {
  any,
  dict,
  enum: enums,
  function: func,
  list,
  object,
  optional,
  scalar,
  tuple,
  union,
  intersection,
}
