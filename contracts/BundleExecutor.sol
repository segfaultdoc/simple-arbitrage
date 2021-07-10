//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.6;

pragma experimental ABIEncoderV2;

interface IERC20 {
    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint);
    function balanceOf(address owner) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);

    function approve(address spender, uint value) external returns (bool);
    function transfer(address to, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint) external;
}

// This contract simply calls multiple targets sequentially, ensuring WETH balance before and after

contract FlashBotsMultiCall {
    address private immutable owner;
    address private immutable executor;
    IWETH private constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    modifier onlyExecutor() {
        require(msg.sender == executor, "must be an executor");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "must be the owner");
        _;
    }

    constructor(address _executor) payable {
        owner = msg.sender;
        executor = _executor;
        if (msg.value > 0) {
            WETH.deposit{value: msg.value}();
        }
    }

    receive() external payable {
        
    }

    function uniswapWeth(
        uint256 _wethAmountToFirstMarket,
        address[] memory _targets,
        bytes[] memory _payloads
    )
    external onlyExecutor payable 
    {
        require (_targets.length == _payloads.length, "targets and payloads lengths must match");
        uint256 _wethBalanceBefore = WETH.balanceOf(address(this));
        WETH.transfer(_targets[0], _wethAmountToFirstMarket);
        for (uint256 i = 0; i < _targets.length; i++) {
            (bool _success, bytes memory _response) = _targets[i].call(_payloads[i]);
            require(_success, "unsuccessful target response"); _response;
        }

        uint256 _wethBalanceAfter = WETH.balanceOf(address(this));
        require(_wethBalanceAfter > _wethBalanceBefore, "tx not profitable");
    }

    function call(
        address payable _to,
        uint256 _value,
        bytes calldata _data
    ) external onlyOwner payable returns (bytes memory) {
        require(_to != address(0), "0 address is invalid");
        (bool _success, bytes memory _result) = _to.call{value: _value}(_data);
        require(_success, "unsuccessful call response");
        
        return _result;
    }
}
