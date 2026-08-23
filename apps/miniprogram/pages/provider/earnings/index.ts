const { api } = getApp<any>().globalData;
Page({ data: { settlements: [] }, async onShow(this: any) { this.setData({ settlements: await api.getEarnings() }); } });
