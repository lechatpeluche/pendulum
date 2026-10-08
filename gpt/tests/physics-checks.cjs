/* Run with: node tests/physics-checks.cjs. No dependencies. */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({performance});
vm.runInContext(script + '\nglobalThis.physics = PendulumPhysics;', context);
const P = context.physics;
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS', name); }
const link = (length=1, mass=1, angle=0) => ({length, mass, angle});
const chain = (...links) => ({links});
const maxDifference = (a,b) => Math.max(...a.map((v,i) => Math.abs(v-b[i])));
function run(config, duration, options) {
  const model = new P.System(config, options);
  let peakEnergy = 0, lengthError = 0;
  model.advanceTo(duration, Infinity, () => {
    peakEnergy = Math.max(peakEnergy, ...model.energyErrors());
    model.points().forEach((points,p) => {
      let previous = {x:0,y:0};
      points.forEach((point,i) => {
        lengthError = Math.max(lengthError, Math.abs(Math.hypot(point.x-previous.x,point.y-previous.y)-config[p].links[i].length));
        previous = point;
      });
    });
  });
  return {model, peakEnergy, lengthError};
}

check('Input boundaries, increments, empty/non-finite values', () => {
  for (const [key,r] of Object.entries(P.rules)) {
    assert.equal(P.validate(r.min,key),'');
    assert.equal(P.validate(r.max,key),'');
    assert.equal(P.validate(r.min+r.step,key),'');
    for (const value of ['', ' ', 'NaN', 'Infinity', r.min-r.step, r.max+r.step, r.min+r.step/2]) assert.ok(P.validate(value,key), `${key}: ${value}`);
  }
  assert.equal(P.validate('120.0001','angle'),'');
  assert.equal(P.validate('-179.9999','angle'),'');
});

check('Absolute-angle geometry and exact constant rod lengths', () => {
  const config = [chain(link(2,1,90),link(3,2,0),link(.25,10,-90),link(1,1,180))];
  const model = new P.System(config), points = model.points()[0];
  const expected = [[2,0],[2,3],[1.75,3],[1.75,2]];
  points.forEach((p,i) => assert.ok(Math.hypot(p.x-expected[i][0],p.y-expected[i][1])<1e-14));
  const result = run(config,5);
  assert.ok(result.lengthError<5e-15, `length error ${result.lengthError}`);
});

check('Exact downward, inverted, and mixed equilibria (1–4 links)', () => {
  for(let n=1;n<=4;n++) for(const angles of [Array(n).fill(0),Array(n).fill(180),Array.from({length:n},(_,i)=>i%2?-180:0)]) {
    const config = [chain(...angles.map((a,i)=>link(i%2?.25:5,i%2?500:1,a)))];
    const model = new P.System(config), initial = Array.from(model.y);
    model.advanceTo(10);
    assert.deepEqual(Array.from(model.y),initial);
    assert.equal(model.energyErrors()[0],0);
  }
});

check('Single pendulum nonlinear acceleration, mass independence, unrestricted rotation', () => {
  for(const mass of [1,500]) {
    const model = new P.System([chain(link(.25,mass,120))]);
    const dy = model.derivative(model.y,new Float64Array(2));
    assert.ok(Math.abs(dy[1]+9.81/.25*Math.sin(2*Math.PI/3))<1e-13);
  }
  const a=run([chain(link(1,1,150))],8).model;
  const b=run([chain(link(1,500,150))],8).model;
  assert.ok(maxDifference(a.y,b.y)<1e-10);
  // Nonzero velocity is test-only: verify that the equations have no mechanical stops.
  const spinning = new P.System([chain(link(1,1,0))]);
  spinning.y[1]=10;spinning.advanceTo(3);
  assert.ok(spinning.y[0]>6*Math.PI);
});

check('Large-angle single pendulum period against independent elliptic-integral AGM formula', () => {
  for(const [length,angle] of [[.25,5],[1,120],[5,179]]) {
    let a=1,b=Math.cos(angle*Math.PI/360);
    for(let i=0;i<20;i++) {const old=a;a=(a+b)/2;b=Math.sqrt(old*b);}
    const period=2*Math.PI*Math.sqrt(length/9.81)/a;
    const model=new P.System([chain(link(length,17,angle))]);
    model.advanceTo(period);
    const angleError=Math.abs(model.y[0]-angle*Math.PI/180),velocityError=Math.abs(model.y[1]);
    assert.ok(angleError<2e-7&&velocityError<2e-6, `L=${length}, angle=${angle}, errors=${angleError},${velocityError}`);
    console.log(`  ${angle}° / ${length} m: T=${period.toFixed(8)} s, return error=${Math.max(angleError,velocityError).toExponential(2)}`);
  }
});

check('Double pendulum acceleration against independent explicit equations', () => {
  const model=new P.System([chain(link(.25,1,120),link(5,500,-35))]);
  const [a,b]=model.y, w1=2.3,w2=-.8,l1=.25,l2=5,m1=1,m2=500,g=9.81;
  model.y[2]=w1;model.y[3]=w2;
  const denominator=2*m1+m2-m2*Math.cos(2*a-2*b);
  const alpha1=(-g*(2*m1+m2)*Math.sin(a)-m2*g*Math.sin(a-2*b)-2*Math.sin(a-b)*m2*(w2*w2*l2+w1*w1*l1*Math.cos(a-b)))/(l1*denominator);
  const alpha2=2*Math.sin(a-b)*(w1*w1*l1*(m1+m2)+g*(m1+m2)*Math.cos(a)+w2*w2*l2*m2*Math.cos(a-b))/(l2*denominator);
  const dy=model.derivative(model.y,new Float64Array(4));
  assert.ok(Math.abs(dy[2]-alpha1)<1e-10);
  assert.ok(Math.abs(dy[3]-alpha2)<1e-10);
});

check('1–4 link dynamics satisfy independent Cartesian joint-force balance', () => {
  for(let n=1;n<=4;n++) {
    const config=chain(...Array.from({length:n},(_,i)=>link([.25,5,.8,3][i],[1,500,7,200][i],[140,-60,12,-170][i])));
    const model=new P.System([config]);
    for(let i=0;i<n;i++) model.y[n+i]=[3,-.7,4,-2][i];
    const dy=model.derivative(model.y,new Float64Array(2*n));
    // Required force for all downstream masses must act along each massless rod.
    const forces=[];let ax=0,ay=0;
    config.links.forEach((l,i)=>{
      const a=model.y[i],w=model.y[n+i],alpha=dy[n+i];
      ax+=l.length*(Math.cos(a)*alpha-Math.sin(a)*w*w);
      ay-=l.length*(Math.sin(a)*alpha+Math.cos(a)*w*w);
      forces.push({x:l.mass*ax,y:l.mass*(ay-9.81)});
    });
    let fx=0,fy=0;
    for(let i=n-1;i>=0;i--) {
      fx+=forces[i].x;fy+=forces[i].y;
      const tangent=fx*Math.cos(model.y[i])-fy*Math.sin(model.y[i]);
      assert.ok(Math.abs(tangent)<1e-7, `n=${n}, joint=${i}, tangential residual=${tangent}`);
    }
  }
});

check('Synchronized independent pendulums; identical states are not offset', () => {
  const config=P.defaults();config.push(P.clone(config[0]));config.push(chain(link(.25,500,-75)));
  const model=run(config,10).model;
  assert.equal(model.t,10);
  assert.deepEqual(Array.from(model.y.slice(0,4)),Array.from(model.y.slice(8,12)));
  const independently=run([config[3]],10).model;
  assert.ok(maxDifference(model.y.slice(12),independently.y)<1e-7);
});

const stressCases = [
  ['default pair',P.defaults(),30],
  ['four-link equal', [chain(link(1,1,120),link(1,1,-10),link(1,1,35),link(1,1,-80))],15],
  ['short rods, alternating mass extremes',[chain(link(.25,1,170),link(.25,500,-30),link(.25,1,100),link(.25,500,-120))],8],
  ['mixed length and mass extremes',[chain(link(5,500,179),link(.25,1,-179),link(5,1,75),link(.25,500,-80))],8],
  ['heavy pivot, light tips',[chain(link(.25,500,90),link(5,1,90),link(.25,1,90),link(5,1,90))],8],
  ['near aligned, heavy final mass',[chain(link(.25,1,120),link(.25,1,120),link(.25,1,120),link(.25,500,120.0001))],8],
];
check('Energy conservation and constant lengths through dynamic stress cases', () => {
  for(const [name,config,duration] of stressCases) {
    const {model,peakEnergy,lengthError}=run(config,duration);
    console.log(`  ${name}: peak ΔE/Escale=${peakEnergy.toExponential(3)}, length=${lengthError.toExponential(2)}, steps=${model.accepted}, rejected=${model.rejected}`);
    assert.ok(peakEnergy<2e-6,`${name}: energy ${peakEnergy}`);
    assert.ok(lengthError<1e-14,`${name}: length ${lengthError}`);
    assert.ok(Array.from(model.y).every(Number.isFinite));
  }
});

check('Convergence with tighter tolerances AND a smaller maximum step', () => {
  for(const [name,config] of [stressCases[1],stressCases[2],stressCases[3],stressCases[5]]) {
    const opts=[{rtol:1e-6,atol:1e-8,maxStep:1/60},{rtol:1e-9,atol:1e-11,maxStep:1/120},{rtol:1e-12,atol:1e-14,maxStep:1/480}];
    const results=opts.map(o=>run(config,1.5,o));
    const coarseError=maxDifference(results[0].model.y,results[2].model.y);
    const defaultError=maxDifference(results[1].model.y,results[2].model.y);
    console.log(`  ${name}: coarse=${coarseError.toExponential(3)}, default=${defaultError.toExponential(3)}, improvement=${(coarseError/defaultError).toFixed(1)}×`);
    assert.ok(defaultError<coarseError/5,`${name}: convergence not demonstrated`);
    assert.ok(defaultError<2e-3,`${name}: short-horizon state error ${defaultError}`);
  }
});

check('Rejected steps preserve state, budgeted work advances only accepted states, samples are bounded in time', () => {
  const model=new P.System(stressCases[2][1],{rtol:1e-13,atol:1e-15});model.h=1/120;
  const before=Array.from(model.y);
  assert.equal(model.step(.1),false);assert.equal(model.t,0);assert.deepEqual(Array.from(model.y),before);
  model.advanceTo(100,0);assert.ok(model.t<.1);
  const samples=[];model.advanceTo(1,Infinity,t=>samples.push(t));
  assert.equal(model.t,1);assert.ok(samples.length>=119);
  samples.forEach(t=>assert.ok(Math.abs(t*120-Math.round(t*120))<1e-10));
  assert.equal(model.y.length,8);
});
check('Tiny output-boundary steps do not collapse the next adaptive step (regression)', () => {
  const model=new P.System(P.defaults());
  model.advanceTo(1/120);
  model.advanceTo(1/120+1e-14);
  assert.ok(model.h>1e-6,`boundary collapsed adaptive step to ${model.h}`);
  for(let i=1;i<=30;i++) model.advanceTo(i*.017+Number.EPSILON);
  assert.ok(Array.from(model.y).every(Number.isFinite));
  assert.ok(model.energyErrors().every(error=>error<1e-7));
});
console.log(`\n${checks} physics checks passed.`);
