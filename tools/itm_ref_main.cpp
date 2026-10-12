#include "../include/itm.h"
#include <cstdio>
#include <cstdlib>
int main(int argc,char**argv){
  // read: htx hrx climate N0 f pol eps sigma mdvar time loc sit np xi z0..znp
  double htx,hrx,N0,f,eps,sig,t,l,s,np,xi; int cl,pol,md;
  while(scanf("%lf %lf %d %lf %lf %d %lf %lf %d %lf %lf %lf %lf %lf",&htx,&hrx,&cl,&N0,&f,&pol,&eps,&sig,&md,&t,&l,&s,&np,&xi)==14){
    std::vector<double> p((int)np+3); p[0]=np;p[1]=xi; for(int i=0;i<=(int)np;i++) scanf("%lf",&p[i+2]);
    double A; long w; IntermediateValues iv;
    int r=ITM_P2P_TLS_Ex(htx,hrx,p.data(),cl,N0,f,pol,eps,sig,md,t,l,s,&A,&w,&iv);
    printf("%d %.10f %d %ld %.10f\n",r,A,iv.mode,w,iv.delta_h__meter);
  }
}
