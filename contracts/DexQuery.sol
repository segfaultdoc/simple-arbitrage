//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.6;

pragma experimental ABIEncoderV2;

interface Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

abstract contract DexFactory  {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;
    function allPairsLength() external view virtual returns (uint);
}

// In order to quickly load up data from Uniswap-like dexes, this contract allows easy iteration with a single eth_call
contract DexQuery {
    function getReservesByPairs(Pool[] calldata _pools) external view returns (uint256[3][] memory) {
        uint256[3][] memory result = new uint256[3][](_pools.length);
        for (uint i = 0; i < _pools.length; i++) {
            (result[i][0], result[i][1], result[i][2]) = _pools[i].getReserves();
        }
        return result;
    }

    function getPairsByIndexRange(
        DexFactory _factory,
        uint256 _start,
        uint256 _stop
    ) external view returns (address[3][] memory)  {
        uint256 _allPairsLength = _factory.allPairsLength();
        if (_stop > _allPairsLength) {
            _stop = _allPairsLength;
        }
        require(_stop >= _start, "start cannot be higher than stop");
        uint256 _qty = _stop - _start;
        address[3][] memory result = new address[3][](_qty);
        for (uint i = 0; i < _qty; i++) {
            Pool p = Pool(_factory.allPairs(_start + i));
            result[i][0] = p.token0();
            result[i][1] = p.token1();
            result[i][2] = address(p);
        }
        return result;
    }
}
